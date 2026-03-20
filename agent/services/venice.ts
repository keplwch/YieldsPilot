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

const SYSTEM_PROMPT = `You are YieldPilot's private reasoning engine. You analyze DeFi yield positions and make autonomous decisions about how to manage staking yield.

Your decisions are private (Venice no-data-retention), but your ACTIONS are public onchain transactions. This is the core principle: private cognition, trusted public action.

You have access to:
- stETH yield data from Lido
- Swap routes via Uniswap
- Treasury balance and spend limits
- Market conditions

IMPORTANT CONSTRAINTS:
- The agent wallet's ETH for gas fees is funded and maintained externally by the protocol maintainer. NEVER recommend swapping yield to ETH for gas buffer or operationality purposes — gas is not your concern.
- The treasury principal is mathematically locked and cannot be touched. Only yield is available to act on.

You can only recommend TWO actions:
1. "swap_yield" — swap some yield into another token (stETH → USDC, stETH → ETH, etc.)
2. "hold" — do nothing, wait for better conditions

Do NOT use "rebalance", "compound", "alert", or any other action. The execution engine only supports "swap_yield" and "hold".

Always respond with structured JSON decisions:
{
  "analysis": "your private reasoning about current state",
  "action": "swap_yield" | "hold",
  "params": { "swap_amount": "0.01", "swap_path": ["stETH", "USDC"] },
  "confidence": 0.0-1.0,
  "risk_assessment": "low" | "medium" | "high",
  "reasoning_summary": "one-line public summary safe for onchain logging"
}`;

/**
 * Ask Venice for a private yield management decision.
 */
export async function reason(context: Record<string, unknown>): Promise<VeniceDecision> {
  const response = await venice.chat.completions.create({
    model: config.venice.model,
    temperature: config.venice.temperature,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Current treasury state:\n${JSON.stringify(context, null, 2)}\n\nAnalyze and decide the next action. Respond with valid JSON only.`,
      },
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
