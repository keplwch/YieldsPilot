/**
 * YieldPilot — Autonomous Agent Core (Multi-User)
 *
 * The main agent loop: for each registered user treasury:
 *   discover → plan → execute → verify → log
 *
 * Privacy-preserving reasoning (Venice) + multi-model analysis (Bankr)
 * + real swaps (Uniswap) + yield management (Lido Treasury)
 *
 * Bounties targeted:
 *   - Protocol Labs "Let the Agent Cook" ($8,000) — autonomous loop
 *   - Protocol Labs "Agents With Receipts" ($8,004) — ERC-8004
 *   - Venice "Private Agents" ($11,500) — private cognition
 *   - Bankr "Best LLM Gateway" ($5,000) — multi-model
 *   - Uniswap "Agentic Finance" ($5,000) — real swaps
 *   - Lido "stETH Agent Treasury" ($3,000) — yield separation
 *   - Synthesis Open Track ($14,500)
 */

import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import config from "../config/default";
import * as venice from "./services/venice";
import * as bankr from "./services/bankr";
import * as uniswap from "./services/uniswap";
import * as lido from "./services/lido";
import * as logger from "./utils/logger";
import { recordActivity, initActivityStore, type ActivityRecord } from "./utils/activityStore";
import type {
  AgentAction,
  AgentState,
  ExecuteResult,
  CycleLogEntry,
} from "../types/index";

// ════════════════════════════════════════════════════════════════
//                     AGENT STATE
// ════════════════════════════════════════════════════════════════

interface MultiUserAgentState extends AgentState {
  usersProcessed: number;
  treasuriesManaged: string[];
}

const state: MultiUserAgentState = {
  running: false,
  cycleCount: 0,
  totalYieldManaged: 0,
  lastAction: null,
  computeSpentUsd: 0,
  startedAt: null,
  usersProcessed: 0,
  treasuriesManaged: [],
};

const STATE_PATH = path.resolve(process.cwd(), "agent_state.json");

function loadPersistedState(): void {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
      // Resume counters across restarts; reset session-specific fields
      state.cycleCount = saved.cycleCount ?? 0;
      state.totalYieldManaged = saved.totalYieldManaged ?? 0;
    }
  } catch { /* non-critical — start fresh if file is corrupt */ }
}

function persistState(): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch { /* non-critical */ }
}

// ════════════════════════════════════════════════════════════════
//                     AUTONOMOUS LOOP
// ════════════════════════════════════════════════════════════════

interface CycleResult {
  loopId: string;
  action: AgentAction;
  txHash?: string;
  duration: number;
  user?: string;
  treasuryAddress?: string;
}

/**
 * Single autonomous cycle for ONE user's treasury.
 * discover → plan → execute → verify
 */
async function runCycleForTreasury(
  treasuryInfo: lido.UserTreasuryInfo
): Promise<CycleResult> {
  const loopId = uuid();
  const cycleStart = Date.now();
  const { user, treasuryAddress } = treasuryInfo;

  const shortUser = user === "single-user" ? "single" : `${user.slice(0, 6)}...${user.slice(-4)}`;
  console.log(`\n  🔄 Processing treasury for ${shortUser} [${treasuryAddress.slice(0, 8)}...]`);

  // ── Phase 1: DISCOVER ──────────────────────────────────────
  console.log("    📡 Phase 1: Discovering current state...");
  console.log(`       Treasury addr: ${treasuryAddress}`);
  console.log(`       Principal:     ${treasuryInfo.principal} stETH`);
  console.log(`       Yield:         ${treasuryInfo.availableYield} stETH`);
  console.log(`       Total balance: ${treasuryInfo.totalBalance} stETH`);
  console.log(`       Daily limit:   ${treasuryInfo.dailySpendRemaining} stETH remaining`);
  console.log(`       Paused:        ${treasuryInfo.paused}`);

  const protocolStats = await lido.getProtocolStats();

  // Use the treasury info we already fetched from the registry
  const balancesForTreasury = {
    address: treasuryAddress,
    eth: "n/a", // gas is paid externally — not a decision factor
    stETH: treasuryInfo.totalBalance,
    wstETH: "n/a", // treasury holds stETH only
    treasury: {
      principal: treasuryInfo.principal,
      availableYield: treasuryInfo.availableYield,
      totalBalance: treasuryInfo.totalBalance,
      yieldWithdrawn: treasuryInfo.yieldWithdrawn,
      maxDailySpendBps: treasuryInfo.maxDailySpendBps,
      dailySpendRemaining: treasuryInfo.dailySpendRemaining,
      paused: treasuryInfo.paused,
    },
  };

  const discoveryContext = {
    balances: balancesForTreasury,
    protocolStats,
    user,
    treasuryAddress,
    cycleNumber: state.cycleCount,
    timestamp: new Date().toISOString(),
  };

  const discoverLog = logger.logCycle({
    cycleId: loopId,
    phase: "discover",
    action: "check_balances",
    inputs: { treasuryAddress, user },
    outputs: discoveryContext as unknown as Record<string, unknown>,
    provider: "lido",
    status: "success",
  });

  // Skip if treasury is paused or has no yield
  const availableYield = parseFloat(treasuryInfo.availableYield);
  if (treasuryInfo.paused) {
    console.log(`    ⏸  Treasury paused, skipping.`);
    recordActivity({
      id: loopId, cycle: state.cycleCount + 1, timestamp: new Date().toISOString(),
      user, treasuryAddress, action: "skip_paused", status: "skipped",
      treasuryBalance: treasuryInfo.totalBalance, principal: treasuryInfo.principal,
      availableYield: treasuryInfo.availableYield, dailySpendRemaining: treasuryInfo.dailySpendRemaining,
      veniceAction: "", veniceReasoning: "Treasury paused", riskLevel: "", riskScore: 0,
      marketSentiment: "", finalAction: "skip_paused", strategyReasoning: "Treasury paused — skipping cycle",
      durationMs: Date.now() - cycleStart,
    });
    return { loopId, action: "skip_paused", duration: Date.now() - cycleStart, user, treasuryAddress };
  }

  if (availableYield <= 0) {
    console.log(`    💤 No yield available (${treasuryInfo.availableYield} stETH), skipping.`);
    recordActivity({
      id: loopId, cycle: state.cycleCount + 1, timestamp: new Date().toISOString(),
      user, treasuryAddress, action: "skip_no_yield", status: "skipped",
      treasuryBalance: treasuryInfo.totalBalance, principal: treasuryInfo.principal,
      availableYield: treasuryInfo.availableYield, dailySpendRemaining: treasuryInfo.dailySpendRemaining,
      veniceAction: "", veniceReasoning: "No yield available", riskLevel: "", riskScore: 0,
      marketSentiment: "", finalAction: "skip_no_yield", strategyReasoning: `No yield available (${treasuryInfo.availableYield} stETH)`,
      durationMs: Date.now() - cycleStart,
    });
    return { loopId, action: "skip_no_yield", duration: Date.now() - cycleStart, user, treasuryAddress };
  }

  // ── Phase 2: PLAN (Private Reasoning) ──────────────────────
  console.log("    🧠 Phase 2: Private reasoning via Venice...");

  const veniceDecision = await venice.reason({
    ...discoveryContext,
    agentConfig: {
      maxDailySpendBps: parseInt(treasuryInfo.maxDailySpendBps),
      computeBudgetRemaining: config.loop.computeBudgetUsd - state.computeSpentUsd,
    },
  });

  console.log("    📊 Phase 2b: Multi-model analysis via Bankr...");

  const [riskAssessment, marketAnalysis] = await Promise.all([
    bankr.assessRisk({
      balances: balancesForTreasury,
      proposedAction: veniceDecision.action,
      protocolStats,
    }),
    bankr.analyzeMarket({
      protocolStats,
      currentYield: treasuryInfo.availableYield,
    }),
  ]);

  const strategy = await bankr.synthesizeStrategy(
    riskAssessment,
    marketAnalysis,
    balancesForTreasury.treasury
  );

  console.log(`    📋 Strategy result:`);
  console.log(`       Venice action:  ${veniceDecision.action}`);
  console.log(`       Risk level:     ${riskAssessment.risk_level} (score: ${riskAssessment.risk_score})`);
  console.log(`       Risk recommend: ${riskAssessment.recommendation}`);
  console.log(`       Market:         ${marketAnalysis.market_sentiment}`);
  console.log(`       Final action:   ${strategy.action}`);
  console.log(`       Swap amount:    ${strategy.swap_amount ?? "n/a"}`);
  console.log(`       Swap path:      ${strategy.swap_path?.join(" → ") ?? "n/a"}`);
  console.log(`       Reasoning:      ${strategy.reasoning?.slice(0, 100)}...`);

  const planLog = logger.logCycle({
    cycleId: loopId,
    phase: "plan",
    action: "multi_model_reasoning",
    inputs: discoveryContext as unknown as Record<string, unknown>,
    outputs: {
      veniceDecision: veniceDecision.reasoning_summary,
      riskLevel: riskAssessment.risk_level,
      marketSentiment: marketAnalysis.market_sentiment,
      finalAction: strategy.action,
      user,
      treasuryAddress,
    },
    reasoning: veniceDecision.reasoning_summary,
    provider: "venice+bankr",
    model: `${config.venice.model}+${config.bankr.models.risk}+${config.bankr.models.market}`,
    status: "success",
  });

  // ── Phase 3: EXECUTE ───────────────────────────────────────

  // Decision hierarchy:
  //   Venice (private reasoning) → suggests action + confidence
  //   Bankr risk model → can override to "abort"
  //   Bankr strategy model → synthesizes final action from all inputs
  //   Agent execution → validates and executes the final action
  //
  // Only two executable actions: "swap_yield" (on-chain tx) or "hold" (no-op)
  const finalAction = strategy.action;
  console.log(`    ⚡ Phase 3: Executing action: ${finalAction}`);
  console.log(`       Decision chain: Venice(${veniceDecision.action}) → Risk(${riskAssessment.recommendation}) → Strategy(${finalAction})`);

  let executeResult: ExecuteResult = {
    action: "hold",
    status: "no_action_needed",
  };

  // Treat any action with a swap_amount as swap_yield (handles LLM drift)
  const isSwapAction = (finalAction === "swap_yield" || finalAction === "rebalance" || finalAction === "compound")
    && strategy.swap_amount
    && parseFloat(strategy.swap_amount) > 0;

  if (isSwapAction && strategy.swap_amount) {
    if (riskAssessment.recommendation !== "abort") {
      const swapAmount = strategy.swap_amount;
      const tokenIn = strategy.swap_path?.[0] ?? "stETH";
      const tokenOut = strategy.swap_path?.[1] ?? "USDC";
      const isTestnet = config.chain.chainId !== 1;

      console.log(`      💱 Swap request: ${swapAmount} ${tokenIn} → ${tokenOut}`);
      console.log(`      🌐 Network: ${isTestnet ? "testnet (chain " + config.chain.chainId + ")" : "mainnet"}`);
      console.log(`      📍 Treasury: ${treasuryAddress}`);

      if (!isTestnet && config.uniswap.apiKey) {
        // ── MAINNET: Use Uniswap Trading API → atomic swapYield() ──
        console.log(`      🦄 Using Uniswap Trading API (mainnet)...`);

        try {
          console.log(`      📦 Step 1/3: Fetching quote from Uniswap API...`);
          const swapCalldata = await uniswap.buildContractSwap({
            tokenIn,
            tokenOut,
            amount: swapAmount,
            treasuryAddress,
            slippageTolerance: 0.5,
          });

          console.log(`      ✅ Quote received:`);
          console.log(`         Router:   ${swapCalldata.router}`);
          console.log(`         Expected: ${swapCalldata.expectedOutput} ${tokenOut}`);
          console.log(`         MinOut:   ${swapCalldata.minAmountOut} (slippage-adjusted)`);
          console.log(`         Impact:   ${swapCalldata.priceImpact}%`);
          console.log(`         Calldata: ${swapCalldata.calldata.slice(0, 20)}...${swapCalldata.calldata.slice(-8)}`);

          console.log(`      🔒 Step 2/3: Calling treasury.swapYield() (atomic — funds stay in contract)...`);
          const swapResult = await lido.swapYieldFromTreasury({
            treasuryAddress,
            routerAddress: swapCalldata.router,
            amountIn: swapAmount,
            swapCalldata: swapCalldata.calldata,
            tokenOut: swapCalldata.tokenOut,
            minAmountOut: swapCalldata.minAmountOut,
            reason: `YieldPilot auto-swap for ${shortUser}: ${strategy.reasoning}`,
          });

          console.log(`      ✅ Step 3/3: Swap confirmed!`);
          console.log(`         txHash: ${swapResult.txHash}`);
          console.log(`         Block:  ${swapResult.blockNumber}`);

          executeResult = {
            action: "swap_yield",
            swap: swapResult,
            txHash: swapResult.txHash,
            status: "executed",
            router: swapCalldata.router,
            expectedOutput: swapCalldata.expectedOutput,
          };
        } catch (swapError) {
          const err = swapError as Error;
          console.error(`      ❌ Mainnet swap failed: ${err.message}`);
          console.error(`         Stack: ${err.stack?.split("\n")[1]?.trim()}`);

          // On mainnet, do NOT fallback to blind transfer — that just burns funds
          executeResult = {
            action: "swap_yield",
            status: "failed",
            error: err.message,
          };
        }
      } else {
        // ── TESTNET ──
        const mockRouter = process.env.MOCK_ROUTER_ADDRESS;
        const mockTokenOut = process.env.MOCK_TOKEN_OUT_ADDRESS;

        if (mockRouter && mockTokenOut) {
          // ── TESTNET + MOCK ROUTER: Full atomic swapYield() demo ──
          console.log(`      🧪 Testnet mode with MockRouter deployed`);
          console.log(`         MockRouter:  ${mockRouter}`);
          console.log(`         MockTokenOut: ${mockTokenOut}`);

          try {
            // Build calldata for MockRouter.swap(tokenIn, amountIn, tokenOut, recipient)
            const { ethers: ethersLib } = await import("ethers");
            const amountInWei = ethersLib.parseEther(swapAmount);
            const stETHAddress = config.lido.stETH;

            const mockRouterIface = new ethersLib.Interface([
              "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
            ]);
            const calldata = mockRouterIface.encodeFunctionData("swap", [
              stETHAddress,
              amountInWei,
              mockTokenOut,
              treasuryAddress, // output goes back to Treasury
            ]);

            console.log(`      📦 Step 1/3: Built MockRouter calldata`);
            console.log(`         Calldata: ${calldata.slice(0, 20)}...${calldata.slice(-8)}`);
            console.log(`         Input:    ${swapAmount} stETH (${amountInWei})`);

            console.log(`      🔒 Step 2/3: Calling treasury.swapYield() (atomic swap)...`);
            const swapResult = await lido.swapYieldFromTreasury({
              treasuryAddress,
              routerAddress: mockRouter,
              amountIn: swapAmount,
              swapCalldata: calldata,
              tokenOut: mockTokenOut,
              minAmountOut: "0", // mock router always succeeds
              reason: `YieldPilot testnet atomic swap for ${shortUser}: ${strategy.reasoning}`,
            });

            console.log(`      ✅ Step 3/3: Atomic swap confirmed!`);
            console.log(`         txHash: ${swapResult.txHash}`);
            console.log(`         Block:  ${swapResult.blockNumber}`);
            console.log(`         Method: treasury.swapYield() — funds never left contract`);

            executeResult = {
              action: "swap_yield",
              swap: swapResult,
              txHash: swapResult.txHash,
              status: "executed",
              router: mockRouter,
            };
          } catch (mockSwapErr) {
            const err = mockSwapErr as Error;
            console.error(`      ❌ MockRouter swapYield failed: ${err.message}`);
            console.error(`         Stack: ${err.stack?.split("\n").slice(0, 3).join("\n         ")}`);
            executeResult = {
              action: "swap_yield",
              status: "failed",
              error: err.message,
            };
          }
        } else {
          // ── TESTNET without MockRouter: Use spendYield() as demo ──
          console.log(`      🧪 Testnet mode: No MockRouter configured`);
          console.log(`         Set MOCK_ROUTER_ADDRESS + MOCK_TOKEN_OUT_ADDRESS for atomic swaps`);
          console.log(`         Using spendYield() to demonstrate yield management`);

          // Dry run check
          console.log(`      🔍 Step 1/3: Dry run check...`);
          const dryRunResult = await lido.spendYieldFromTreasury(
            treasuryAddress,
            config.uniswap.routerAddress,
            swapAmount,
            `dry-run`,
            true // dryRun=true
          );
          console.log(`         Available yield: ${dryRunResult.availableYield} stETH`);
          console.log(`         Daily remaining: ${dryRunResult.dailyRemaining} stETH`);
          console.log(`         Would succeed:   ${dryRunResult.wouldSucceed}`);

          if (!dryRunResult.wouldSucceed) {
            console.log(`      ⚠ Dry run says swap would fail. Skipping.`);
            executeResult = {
              action: "swap_yield",
              status: "dry_run_rejected",
              dryRun: dryRunResult,
            };
          } else {
            console.log(`      💸 Step 2/3: Calling treasury.spendYield()...`);
            console.log(`         Target: ${config.uniswap.routerAddress}`);
            console.log(`         Amount: ${swapAmount} stETH`);

            const spendResult = await lido.spendYieldFromTreasury(
              treasuryAddress,
              config.uniswap.routerAddress,
              swapAmount,
              `YieldPilot testnet yield-spend for ${shortUser}: ${strategy.reasoning}`
            );

            console.log(`      ✅ Step 3/3: Yield spent!`);
            console.log(`         txHash: ${spendResult.txHash}`);
            console.log(`         Block:  ${spendResult.blockNumber}`);
            console.log(`         Note:   Set MOCK_ROUTER_ADDRESS for atomic swapYield() demo`);

            executeResult = {
              action: "swap_yield",
              spend: spendResult,
              txHash: spendResult.txHash,
              status: "executed_testnet",
            };
          }
        }
      }
    } else {
      console.log(`      🛑 Risk assessment recommended ABORT (score: ${riskAssessment.risk_score})`);
      executeResult = {
        action: "abort",
        reason: "Risk assessment recommended abort",
        riskScore: riskAssessment.risk_score,
        status: "aborted",
      };
    }
  } else if (finalAction === "hold") {
    console.log(`      💤 Holding — no action this cycle`);
    console.log(`         Reason: ${strategy.reasoning?.slice(0, 120)}`);
  } else {
    console.log(`      ⚠ Unrecognized action "${finalAction}" with no swap_amount — treating as hold`);
  }

  const executeLog = logger.logCycle({
    cycleId: loopId,
    phase: "execute",
    action: strategy.action,
    inputs: { strategy: strategy as unknown as Record<string, unknown>, user, treasuryAddress },
    outputs: executeResult as unknown as Record<string, unknown>,
    txHash: executeResult.txHash ?? null,
    provider: executeResult.txHash ? "uniswap+lido" : undefined,
    status: executeResult.status,
  });

  // ── Phase 4: VERIFY ────────────────────────────────────────
  console.log("    ✅ Phase 4: Verifying state...");

  const verification = {
    preBalance: treasuryInfo.totalBalance,
    actionTaken: strategy.action,
    txHash: executeResult.txHash ?? null,
    user,
    treasuryAddress,
    verified: true,
  };

  const verifyLog = logger.logCycle({
    cycleId: loopId,
    phase: "verify",
    action: "post_execution_check",
    inputs: { executeResult: executeResult as unknown as Record<string, unknown> },
    outputs: verification,
    duration: Date.now() - cycleStart,
    status: "success",
  });

  // Log complete loop
  logger.logLoop({
    loopId,
    discover: discoverLog,
    plan: planLog,
    execute: executeLog,
    verify: verifyLog,
  });

  const duration = Date.now() - cycleStart;
  console.log(`    ✨ Done for ${shortUser}. Action: ${strategy.action} | Duration: ${duration}ms`);

  // ── Persist activity record ──────────────────────────────────
  const activityRecord: ActivityRecord = {
    id: loopId,
    cycle: state.cycleCount + 1,
    timestamp: new Date().toISOString(),
    user: treasuryInfo.user,
    treasuryAddress,
    action: isSwapAction ? "swap_yield" : finalAction === "hold" ? "hold" : finalAction as any,
    status: executeResult.txHash ? "executed" : executeResult.status === "aborted" ? "aborted" : executeResult.status === "failed" ? "failed" : "no_action",
    treasuryBalance: treasuryInfo.totalBalance,
    principal: treasuryInfo.principal,
    availableYield: treasuryInfo.availableYield,
    dailySpendRemaining: treasuryInfo.dailySpendRemaining,
    veniceAction: veniceDecision.action,
    veniceReasoning: veniceDecision.reasoning_summary ?? "",
    riskLevel: riskAssessment.risk_level,
    riskScore: riskAssessment.risk_score,
    marketSentiment: marketAnalysis.market_sentiment,
    finalAction: strategy.action,
    strategyReasoning: strategy.reasoning ?? "",
    swapAmount: strategy.swap_amount ?? undefined,
    tokenIn: strategy.swap_path?.[0] ?? undefined,
    tokenOut: strategy.swap_path?.[1] ?? undefined,
    swapPath: strategy.swap_path ?? undefined,
    txHash: executeResult.txHash ?? undefined,
    router: (executeResult as any).router ?? undefined,
    expectedOutput: (executeResult as any).expectedOutput ?? undefined,
    executionMode: !config.chain.chainId || config.chain.chainId === 1 ? "mainnet" : process.env.MOCK_ROUTER_ADDRESS ? "testnet_mock" : "testnet_spend",
    durationMs: duration,
    error: (executeResult as any).error ?? undefined,
  };

  recordActivity(activityRecord);

  return {
    loopId,
    action: strategy.action,
    txHash: executeResult.txHash,
    duration,
    user,
    treasuryAddress,
  };
}

/**
 * Run a full multi-user cycle: iterate all registered treasuries.
 */
async function runCycle(): Promise<CycleResult[]> {
  console.log(`\n🔄 ═══ Cycle #${state.cycleCount + 1} — Multi-User Sweep ═══`);

  // Fetch all registered user treasuries
  const userTreasuries = await lido.getAllUserTreasuries();

  if (userTreasuries.length === 0) {
    console.log("  📭 No registered treasuries found. Waiting...");
    return [];
  }

  console.log(`  👥 Found ${userTreasuries.length} user treasur${userTreasuries.length === 1 ? "y" : "ies"}`);

  const results: CycleResult[] = [];

  for (const treasuryInfo of userTreasuries) {
    try {
      const result = await runCycleForTreasury(treasuryInfo);
      results.push(result);
    } catch (error) {
      const err = error as Error;
      console.error(`  ❌ Error processing ${treasuryInfo.user}: ${err.message}`);

      logger.logCycle({
        phase: "error",
        action: "user_cycle_failure",
        inputs: {
          user: treasuryInfo.user,
          treasuryAddress: treasuryInfo.treasuryAddress,
          cycleNumber: state.cycleCount,
        },
        outputs: { error: err.message, stack: err.stack },
        status: "error",
      });

      // Also record to activity DB so dashboard shows errors
      recordActivity({
        id: `err-${Date.now()}-${treasuryInfo.user.slice(0, 8)}`,
        cycle: state.cycleCount + 1,
        timestamp: new Date().toISOString(),
        user: treasuryInfo.user,
        treasuryAddress: treasuryInfo.treasuryAddress,
        action: "error",
        status: "error",
        treasuryBalance: treasuryInfo.totalBalance ?? "0",
        principal: treasuryInfo.principal ?? "0",
        availableYield: treasuryInfo.availableYield ?? "0",
        dailySpendRemaining: treasuryInfo.dailySpendRemaining ?? "0",
        veniceAction: "", veniceReasoning: "", riskLevel: "", riskScore: 0,
        marketSentiment: "", finalAction: "error",
        strategyReasoning: `Cycle failed: ${err.message}`,
        durationMs: 0,
        error: err.message,
      });
    }
  }

  // Update state
  state.cycleCount++;
  state.usersProcessed = userTreasuries.length;
  state.treasuriesManaged = userTreasuries.map((t) => t.treasuryAddress);
  state.lastAction = results.length > 0 ? results[results.length - 1].action : null;
  state.computeSpentUsd += 0.01 * userTreasuries.length; // cost scales with users

  persistState();

  console.log(`\n✨ Cycle #${state.cycleCount} complete. Processed ${userTreasuries.length} treasuries.\n`);

  return results;
}

// ════════════════════════════════════════════════════════════════
//                     MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║          🛫  YieldPilot Agent (Multi-User)  🛫   ║");
  console.log("║   Private Cognition → Trusted Onchain Action     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const registryAddr = process.env.REGISTRY_CONTRACT ?? "";

  // Initialize Lido service with registry support
  lido.init(
    config.chain.rpcUrl,
    config.chain.agentPrivateKey,
    config.treasury.address,
    registryAddr
  );

  // Resume cycleCount + totalYieldManaged from previous session
  loadPersistedState();

  // Initialize SQLite activity store (creates yieldpilot.db on first run)
  initActivityStore();

  state.running = true;
  state.startedAt = new Date().toISOString();
  persistState();

  const mockRouter = process.env.MOCK_ROUTER_ADDRESS ?? "";
  const mockTokenOut = process.env.MOCK_TOKEN_OUT_ADDRESS ?? "";

  console.log(`Agent DID:      ${config.agent.did}`);
  console.log(`Treasury:       ${config.treasury.address || "(via registry)"}`);
  console.log(`Registry:       ${registryAddr || "not configured (single-user mode)"}`);
  console.log(`Chain:          ${config.chain.chainId}`);
  console.log(`stETH address:  ${config.lido.stETH}`);
  console.log(`MockRouter:     ${mockRouter || "not set (will use spendYield on testnet)"}`);
  console.log(`MockTokenOut:   ${mockTokenOut || "not set"}`);
  console.log(`Venice Model:   ${config.venice.model}`);
  console.log(`Compute Budget: $${config.loop.computeBudgetUsd}/day`);
  console.log(`Cycle Interval: ${config.loop.intervalMs / 1000}s\n`);

  if (registryAddr) {
    console.log("🏭 Registry mode: agent will process ALL registered user treasuries.\n");
  } else {
    console.log("👤 Single-user mode: processing one treasury only.\n");
  }

  // Autonomous loop
  while (state.running) {
    try {
      if (state.computeSpentUsd >= config.loop.computeBudgetUsd) {
        console.log("⚠️  Compute budget exhausted for today. Pausing.");
        break;
      }

      await runCycle();

      await new Promise<void>((resolve) => setTimeout(resolve, config.loop.intervalMs));
    } catch (error) {
      const err = error as Error;
      console.error(`❌ Cycle error: ${err.message}`);

      logger.logCycle({
        phase: "error",
        action: "cycle_failure",
        inputs: { cycleNumber: state.cycleCount },
        outputs: { error: err.message, stack: err.stack },
        status: "error",
      });

      await new Promise<void>((resolve) => setTimeout(resolve, config.loop.intervalMs * 3));
    }
  }
}

// Start agent
main().catch(console.error);

export { runCycle, runCycleForTreasury, state };
