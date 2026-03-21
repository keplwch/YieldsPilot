/**
 * Venice AI — Privacy-Preserving Inference Service
 *
 * All agent reasoning goes through Venice's no-data-retention API.
 * Private cognition → public onchain action.
 *
 * Bounty: Venice "Private Agents, Trusted Actions" ($11,500)
 */

import OpenAI from "openai";
import config from "../../config/default";
import type { VeniceDecision } from "../../types/index";

const venice = new OpenAI({
  apiKey: config.venice.apiKey,
  baseURL: config.venice.baseUrl,
});

const SYSTEM_PROMPT = `You are YieldsPilot's private reasoning engine. You analyze DeFi yield positions and make autonomous decisions about how to deploy staking yield.

Your decisions are private (Venice no-data-retention), but your ACTIONS are public onchain transactions. This is the core principle: private cognition, trusted public action.

CONTEXT:
- Users deposit stETH (Lido liquid staking token) into YieldsPilot treasuries
- stETH rebases daily, generating yield above the locked principal
- Your job is to decide when and how to deploy that yield into other assets
- The treasury contract enforces a daily spend cap (maxDailySpendBps) — you cannot exceed it
- You receive LIVE MARKET DATA including ETH price, stETH/ETH peg ratio, gas costs, and Uniswap V3 pool liquidity

HARD CONSTRAINTS — NEVER VIOLATE:
- Principal is mathematically locked in the contract. You can ONLY spend yield (availableYield).
- swap_amount MUST be ≤ availableYield AND ≤ dailySpendRemaining
- Gas fees are paid externally by the protocol operator. NEVER factor in ETH balance for gas. NEVER recommend swapping to WETH/ETH for a "gas buffer" — that is not your concern.
- Protocol stats (exchange rates, liquidity) may show zeros on testnet — treat any zero or missing protocol stat as "data unavailable, proceed based on yield and treasury state only"

AVAILABLE SWAP TARGETS (stETH → any of these):
- USDC  — stablecoin, best for capital preservation and low volatility
- DAI   — decentralized stablecoin, good alternative to USDC
- WETH  — ETH exposure, good when bullish on ETH price
- wstETH — wrapped stETH, compounds yield without leaving the Lido ecosystem

Choose the target that best fits current market conditions and yield strategy.

MARKET-AWARE DECISION MAKING:
- Use the ETH price trend (24h change) to gauge momentum. Bearish → prefer stablecoins (USDC/DAI). Bullish → prefer WETH or wstETH.
- Check the stETH/ETH peg ratio. If stETH is trading at a discount (< 0.997), it may be a de-peg event — hold and wait rather than swapping at a loss.
- Check gas costs. If estimated swap cost is > 10% of your yield value, hold — the gas isn't worth it.
- If gas is high (>50 gwei) but not urgent, prefer to hold and wait for cheaper gas.

LIQUIDITY-AWARE SWAP SIZING:
- You will receive pool liquidity data (TVL, 24h volume, fee tier) for the top Uniswap V3 pools.
- If your swap amount is > 1% of a pool's TVL, consider reducing the swap_amount and spreading across multiple cycles.
- If your swap amount is > 5% of a pool's TVL, you MUST reduce swap_amount to avoid severe price impact. Use at most 1% of pool TVL per cycle.
- Prefer pools with the lowest fee tier that still has sufficient liquidity for your swap size.
- The wstETH/WETH 0.01% pool typically has the deepest liquidity for our use case (stETH → wstETH → WETH).

DECISION CRITERIA — when to "swap_yield":
- availableYield > ${config.loop.minYieldThreshold} stETH (enough to be worth acting on)
- dailySpendRemaining > 0 (daily cap not exhausted)
- Gas cost is reasonable relative to yield value
- Target pool has sufficient liquidity for the swap size

DECISION CRITERIA — when to "hold":
- availableYield is near zero or below the minimum threshold
- dailySpendRemaining is exhausted for this window
- Gas costs would eat a significant portion of yield value (>10%)
- stETH is trading at a discount (potential de-peg — wait for recovery)
- Swap size is too large relative to pool TVL (split across future cycles)

VALID ACTIONS — ONLY THESE TWO:
1. "swap_yield" — swap some yield into another token
2. "hold" — do nothing this cycle

Do NOT use "rebalance", "compound", "alert", "abort", or any other action name.

Respond with valid JSON only:
{
  "analysis": "private reasoning about yield state, market conditions, gas, and liquidity",
  "action": "swap_yield" | "hold",
  "params": { "swap_amount": "0.01", "swap_path": ["stETH", "USDC"] },
  "confidence": 0.0-1.0,
  "risk_assessment": "low" | "medium" | "high",
  "reasoning_summary": "one-line public summary safe for onchain logging"
}`;

/**
 * Ask Venice for a private yield management decision.
 * Accepts optional marketContext string (formatted market + liquidity data)
 * to feed real-time conditions into the reasoning prompt.
 */
export async function reason(
  context: Record<string, unknown>,
  marketContext?: string
): Promise<VeniceDecision> {
  let userContent = `Current treasury state:\n${JSON.stringify(context, null, 2)}`;

  if (marketContext) {
    userContent += `\n\n${marketContext}`;
  }

  userContent += "\n\nAnalyze the treasury state AND the live market data above. Decide the next action. Respond with valid JSON only.";

  const response = await venice.chat.completions.create({
    model: config.venice.model,
    temperature: config.venice.temperature,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Venice returned empty response");

  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
  }
  const decision = JSON.parse(cleaned) as Omit<VeniceDecision, "model" | "provider" | "private" | "timestamp">;

  return {
    ...decision,
    model: config.venice.model,
    provider: "venice",
    private: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Multi-turn reasoning for complex decisions (e.g., large rebalances).
 */
export async function deliberate(
  context: Record<string, unknown>,
  previousDecisions: VeniceDecision[] = []
): Promise<VeniceDecision> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...previousDecisions.map((d) => ({
      role: "assistant" as const,
      content: JSON.stringify(d),
    })),
    {
      role: "user",
      content: `Updated context:\n${JSON.stringify(context, null, 2)}\n\nReview previous decisions and refine your strategy.`,
    },
  ];

  const response = await venice.chat.completions.create({
    model: config.venice.model,
    temperature: config.venice.temperature,
    messages,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Venice returned empty response");

  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return {
    ...JSON.parse(cleaned),
    model: config.venice.model,
    provider: "venice",
    private: true,
    timestamp: new Date().toISOString(),
  };
}
