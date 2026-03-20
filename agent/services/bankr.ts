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

export async function assessRisk(portfolioState: RiskInput): Promise<RiskAssessment> {
  const raw = await askBankr<Omit<RiskAssessment, "model" | "provider" | "task">>(
    config.bankr.models.risk,
    `You are a DeFi risk analyst. Evaluate the risk of the given portfolio state and proposed actions. Respond in JSON:
{
  "risk_score": 0-100,
  "risk_level": "low" | "medium" | "high" | "critical",
  "factors": ["factor1", "factor2"],
  "recommendation": "proceed" | "caution" | "abort",
  "max_safe_amount": "amount in ETH",
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
    `You are a DeFi market analyst. Analyze current conditions and recommend swap timing. Respond in JSON:
{
  "market_sentiment": "bullish" | "neutral" | "bearish",
  "eth_trend": "up" | "stable" | "down",
  "steth_discount": "percentage vs ETH",
  "swap_recommendation": "swap_now" | "wait" | "urgent_swap",
  "optimal_pairs": [{"from": "token", "to": "token", "reason": "why"}],
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
    `You are a DeFi strategy synthesizer. Given risk assessment, market analysis, and treasury state, produce a concrete action plan. Respond in JSON:
{
  "action": "hold" | "swap_yield" | "rebalance" | "compound",
  "urgency": "immediate" | "next_cycle" | "no_rush",
  "swap_amount": "amount or null",
  "swap_path": ["tokenA", "tokenB"] or null,
  "slippage_tolerance": 0.005,
  "reasoning": "brief explanation",
  "expected_outcome": "what this achieves"
}`,
    { riskAssessment, marketAnalysis, treasuryState }
  );

  return {
    ...raw,
    model: config.bankr.models.strategy,
    provider: "bankr",
    task: "strategy_synthesis",
  };
}
