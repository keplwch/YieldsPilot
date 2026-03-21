/**
 * Vault Position Monitor + Alert Agent
 *
 * Monitors Lido Earn vaults, detects changes, and sends
 * plain-language Telegram alerts.
 *
 * Bounty: Lido "Vault Position Monitor + Alert Agent" ($1,500)
 */

import TelegramBot from "node-telegram-bot-api";
import config from "../../config/default";
import * as lido from "./lido";

// Initialize - pass both treasury (single-user fallback) and registry (multi-user)
lido.init(
  config.chain.rpcUrl,
  config.chain.agentPrivateKey,
  config.treasury.address,
  (config as any).registry?.address ?? process.env.REGISTRY_CONTRACT
);

const bot: TelegramBot | null = config.telegram.botToken
  ? new TelegramBot(config.telegram.botToken)
  : null;

// ── Types ─────────────────────────────────────────────────────

interface VaultState {
  totalBalance: string;
  principal: string;
  availableYield: string;
  yieldWithdrawn: string;
  exchangeRate: string;
  stEthPerWstEth: string;
  paused: boolean;
  timestamp: string;
}

// Track previous state for change detection
let previousState: VaultState | null = null;

// ── Alert ─────────────────────────────────────────────────────

async function sendAlert(message: string): Promise<void> {
  console.log(`📢 ALERT: ${message}`);

  if (bot && config.telegram.chatId) {
    await bot.sendMessage(config.telegram.chatId, message, {
      parse_mode: "Markdown",
    });
  }
}

// ── Change Explanation ────────────────────────────────────────

function explainChange(field: string, oldVal: string, newVal: string): string {
  const diff = (parseFloat(newVal) - parseFloat(oldVal)).toFixed(6);
  const pct = ((parseFloat(diff) / parseFloat(oldVal)) * 100).toFixed(2);

  const direction = parseFloat(diff) > 0 ? "increased" : "decreased";
  const emoji = parseFloat(diff) > 0 ? "📈" : "📉";

  return `${emoji} *${field}* ${direction} by ${Math.abs(parseFloat(diff)).toFixed(6)} (${Math.abs(parseFloat(pct))}%)\n  Old: ${oldVal}\n  New: ${newVal}`;
}

// ── Monitor Cycle ─────────────────────────────────────────────

async function monitorCycle(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`\n🔍 Monitor check at ${timestamp}`);

  try {
    const [userTreasuries, protocolStats] = await Promise.all([
      lido.getAllUserTreasuries(),
      lido.getProtocolStats(),
    ]);

    // Aggregate across all registered treasuries
    const currentState: VaultState = {
      totalBalance: userTreasuries.reduce((s, t) => s + parseFloat(t.totalBalance), 0).toFixed(6),
      principal: userTreasuries.reduce((s, t) => s + parseFloat(t.principal), 0).toFixed(6),
      availableYield: userTreasuries.reduce((s, t) => s + parseFloat(t.availableYield), 0).toFixed(6),
      yieldWithdrawn: userTreasuries.reduce((s, t) => s + parseFloat(t.yieldWithdrawn), 0).toFixed(6),
      paused: userTreasuries.some((t) => t.paused),
      exchangeRate: protocolStats.exchangeRate,
      stEthPerWstEth: protocolStats.stEthPerWstEth,
      timestamp,
    };

    // First run - establish baseline
    if (!previousState) {
      previousState = currentState;
      console.log("  📋 Baseline established");
      await sendAlert(
        `🛫 *YieldsPilot Monitor Started*\n\n` +
          `💰 Treasury Balance: ${currentState.totalBalance} stETH\n` +
          `🔒 Principal: ${currentState.principal} stETH\n` +
          `✨ Available Yield: ${currentState.availableYield} stETH\n` +
          `📊 Exchange Rate: ${currentState.exchangeRate}`
      );
      return;
    }

    // Detect changes
    const changes: string[] = [];

    if (currentState.availableYield !== previousState.availableYield) {
      changes.push(explainChange("Available Yield", previousState.availableYield, currentState.availableYield));
    }

    if (currentState.totalBalance !== previousState.totalBalance) {
      changes.push(explainChange("Total Balance", previousState.totalBalance, currentState.totalBalance));
    }

    if (currentState.exchangeRate !== previousState.exchangeRate) {
      changes.push(explainChange("stETH/ETH Rate", previousState.exchangeRate, currentState.exchangeRate));
    }

    if (currentState.stEthPerWstEth !== previousState.stEthPerWstEth) {
      changes.push(explainChange("stETH per wstETH", previousState.stEthPerWstEth, currentState.stEthPerWstEth));
    }

    if (currentState.paused !== previousState.paused) {
      changes.push(
        currentState.paused
          ? "⚠️ *Treasury has been PAUSED*"
          : "✅ *Treasury has been UNPAUSED*"
      );
    }

    if (currentState.yieldWithdrawn !== previousState.yieldWithdrawn) {
      const spent = (
        parseFloat(currentState.yieldWithdrawn) - parseFloat(previousState.yieldWithdrawn)
      ).toFixed(6);
      changes.push(`💸 *Agent spent ${spent} stETH* from yield`);
    }

    if (changes.length > 0) {
      const alert =
        `🔔 *YieldsPilot Vault Update*\n\n` +
        changes.join("\n\n") +
        `\n\n---\n` +
        `💰 Balance: ${currentState.totalBalance} stETH\n` +
        `✨ Yield: ${currentState.availableYield} stETH`;

      await sendAlert(alert);
    } else {
      console.log("  ✅ No changes detected");
    }

    // Benchmark check
    const principal = parseFloat(currentState.principal);
    if (principal > 0) {
      const annualizedYield = (parseFloat(currentState.availableYield) / principal) * 365;

      if (annualizedYield < 0.02) {
        await sendAlert(
          `⚠️ *Yield Below Benchmark*\n\n` +
            `Current annualized yield: ${(annualizedYield * 100).toFixed(2)}%\n` +
            `Expected benchmark: ~3.5%\n` +
            `This may indicate a protocol issue.`
        );
      }
    }

    previousState = currentState;
  } catch (error) {
    const err = error as Error;
    console.error(`  ❌ Monitor error: ${err.message}`);
    await sendAlert(`❌ *Monitor Error*: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════
//                     MAIN LOOP
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         🔍 YieldsPilot Vault Monitor 🔍          ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const interval = config.loop.intervalMs * 5; // Check every 5 minutes

  while (true) {
    await monitorCycle();
    await new Promise<void>((r) => setTimeout(r, interval));
  }
}

// Run standalone or import
const isMainModule = process.argv[1]?.includes("vaultMonitor");
if (isMainModule) {
  main().catch(console.error);
}

export { monitorCycle, sendAlert };
