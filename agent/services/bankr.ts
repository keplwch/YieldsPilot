/**
 * Bankr LLM Gateway — Multi-Model Reasoning
 *
 * Uses multiple models through Bankr's gateway for different
 * reasoning tasks: risk assessment, market analysis, strategy.
 *
 * Bounty: Bankr "Best Bankr LLM Gateway Use" ($5,000)
 */

import OpenAI from "openai";
import config from "../../config/default";
import type {
  RiskAssessment,
  MarketAnalysis,
  StrategyResult,
  TreasuryState,
  BalancesResult,
  ProtocolStats,
} from "../../types/index";

const bankr = new OpenAI({
  apiKey: config.bankr.apiKey,
  baseURL: config.bankr.baseUrl,
  defaultHeaders: {
    "X-API-Key": config.bankr.apiKey,
  },
});

// ── Helper ────────────────────────────────────────────────────

async function askBankr<T>(model: string, systemPrompt: string, userContent: unknown): Promise<T> {
  const response = await bankr.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userContent, null, 2) + "\n\nRespond with valid JSON only." },
    ],
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error(`Bankr (${model}) returned empty response`);

  // Strip markdown fences, leading/trailing whitespace, and any non-JSON prefix/suffix
  let cleaned = content.trim();
  // Remove ```json ... ``` wrapping (multiline)
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim();
  // If still not starting with { or [, extract the first JSON object
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
  }
  return JSON.parse(cleaned) as T;
}

// ── Risk Assessment ───────────────────────────────────────────

interface RiskInput {
  balances: BalancesResult;
  proposedAction: string;
  protocolStats: ProtocolStats;
}

const IS_MAINNET = config.chain.chainId === 1;

export async function assessRisk(portfolioState: RiskInput): Promise<RiskAssessment> {
  const protocolStatsNote = IS_MAINNET
    ? `- Protocol liquidity stats and exchange rates are live mainnet data — factor them into your assessment. A stETH exchange rate significantly below 1.0 (e.g. < 0.97) is a genuine risk signal.`
    : `- Protocol liquidity stats and exchange rates are from a testnet mock and will often be zero or missing — treat any zero/null protocol stat as "data unavailable" and do NOT use it as a risk factor.`;

  const raw = await askBankr<Omit<RiskAssessment, "model" | "provider" | "task">>(
    config.bankr.models.risk,
    `You are a DeFi risk analyst for YieldPilot, an autonomous stETH yield management agent.

Your job is to assess whether it is safe to swap staking yield this cycle.

WHAT TO EVALUATE (these are the ONLY relevant risk factors):
- Is availableYield sufficient (> ${config.loop.minYieldThreshold} stETH)? If zero or near-zero → risk is low, just hold
- Does swap_amount stay within dailySpendRemaining? If it exceeds it → high risk
- Is the proposed swap_amount a reasonable fraction of availableYield (not 100% in one shot)?
${protocolStatsNote}

EXPLICITLY IGNORE — these are NOT risk factors in this system:
- ETH balance in the agent wallet (gas is paid externally by the protocol operator, always available)

"abort" recommendation should be RARE — only use it when swap_amount would clearly exceed available yield or daily limits.
"caution" when the swap is large relative to available yield.
"proceed" when yield is available, daily limit has room, and amount is reasonable.

Respond with valid JSON only:
{
  "risk_score": 0-100,
  "risk_level": "low" | "medium" | "high" | "critical",
  "factors": ["factor1", "factor2"],
  "recommendation": "proceed" | "caution" | "abort",
  "max_safe_amount": "amount in stETH",
  "reasoning": "brief explanation"
}`,
    portfolioState
  );

  return {
    ...raw,
    model: config.bankr.models.risk,
    provider: "bankr",
    task: "risk_assessment",
  };
}

// ── Market Analysis ───────────────────────────────────────────

interface MarketInput {
  protocolStats: ProtocolStats;
  currentYield: string;
}

export async function analyzeMarket(marketData: MarketInput): Promise<MarketAnalysis> {
  const raw = await askBankr<Omit<MarketAnalysis, "model" | "provider" | "task">>(
    config.bankr.models.market,
    `You are a DeFi market analyst. Analyze current conditions and recommend swap timing and the best output token.

AVAILABLE OUTPUT TOKENS (from stETH):
- USDC   — stablecoin, best for capital preservation when bearish or uncertain
- DAI    — decentralized stablecoin, good USDC alternative
- WETH   — ETH exposure, best when bullish on ETH price trend
- wstETH — wrapped stETH, best when yield compounding > diversification (bullish on staking APR)

Recommend the optimal_pairs based on market conditions. Respond in JSON:
{
  "market_sentiment": "bullish" | "neutral" | "bearish",
  "eth_trend": "up" | "stable" | "down",
  "steth_discount": "percentage vs ETH",
  "swap_recommendation": "swap_now" | "wait" | "urgent_swap",
  "optimal_pairs": [{"from": "stETH", "to": "USDC" | "DAI" | "WETH" | "wstETH", "reason": "why"}],
  "reasoning": "brief explanation"
}`,
    marketData
  );

  return {
    ...raw,
    model: config.bankr.models.market,
    provider: "bankr",
    task: "market_analysis",
  };
}

// ── Strategy Synthesis ────────────────────────────────────────

export async function synthesizeStrategy(
  riskAssessment: RiskAssessment,
  marketAnalysis: MarketAnalysis,
  treasuryState: TreasuryState | BalancesResult
): Promise<StrategyResult> {
  const raw = await askBankr<Omit<StrategyResult, "model" | "provider" | "task">>(
    config.bankr.models.strategy,
    `You are a DeFi yield management strategy engine for YieldPilot. You receive risk assessment, market analysis, and treasury state. Synthesize the final action for this cycle.

OUTPUT — EXACTLY ONE of two actions:
1. "swap_yield" — deploy some yield by swapping stETH into the best output token
2. "hold" — do nothing this cycle

AVAILABLE OUTPUT TOKENS — choose based on market analysis:
- USDC   — capital preservation, use when bearish or market is uncertain
- DAI    — decentralized stablecoin alternative to USDC
- WETH   — ETH exposure, use when market_sentiment is bullish and eth_trend is "up"
- wstETH — compound staking yield, use when staking APR is the best available return

Use the market analysis "optimal_pairs" as your primary signal for which token to target.

RULES:
- ONLY valid actions: "swap_yield" or "hold". Do NOT output "rebalance", "compound", "abort", or anything else.
- If action is "swap_yield": provide swap_amount (string, stETH units) and swap_path (two token names, e.g. ["stETH", "USDC"]).
- swap_amount MUST be ≤ dailySpendRemaining AND ≤ availableYield. Use at most 50% of available yield per cycle.
- Gas is paid externally. NEVER swap to WETH/ETH for gas purposes.
- If risk recommendation is "abort", output "hold".
- If availableYield is 0 or below ${config.loop.minYieldThreshold}, output "hold".
${IS_MAINNET
    ? "- Protocol stats are live mainnet data. Use them to inform swap timing (e.g. avoid swapping during high slippage or stETH de-peg)."
    : "- Protocol stats are from a testnet mock and may be zero — treat zero/null protocol stats as unavailable data, not a real risk signal."
  }

Respond with valid JSON only:
{
  "action": "swap_yield" | "hold",
  "urgency": "immediate" | "next_cycle" | "no_rush",
  "swap_amount": "0.01",
  "swap_path": ["stETH", "USDC"],
  "slippage_tolerance": 0.005,
  "reasoning": "brief explanation of why this action was chosen",
  "expected_outcome": "what this achieves"
}`,
    { riskAssessment, marketAnalysis, treasuryState }
  );

  // Normalize: if the LLM still outputs a non-standard action, map it
  let action = raw.action;
  if (action !== "swap_yield" && action !== "hold") {
    if (raw.swap_amount && parseFloat(raw.swap_amount) > 0) {
      action = "swap_yield";
    } else {
      action = "hold";
    }
  }

  return {
    ...raw,
    action,
    model: config.bankr.models.strategy,
    provider: "bankr",
    task: "strategy_synthesis",
  };
}
