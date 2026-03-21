// ════════════════════════════════════════════════════════════════
//  YieldsPilot — Shared Type Definitions
// ════════════════════════════════════════════════════════════════

// ── Agent Decision Types ──────────────────────────────────────

export type AgentAction = "hold" | "swap_yield" | "rebalance" | "compound" | "alert" | "abort" | "skip_paused" | "skip_no_yield";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type MarketSentiment = "bullish" | "neutral" | "bearish";
export type SwapRecommendation = "swap_now" | "wait" | "urgent_swap";
export type RiskRecommendation = "proceed" | "caution" | "abort";
export type Urgency = "immediate" | "next_cycle" | "no_rush";
export type CyclePhase = "discover" | "plan" | "execute" | "verify" | "error";
export type CycleStatus = "success" | "error" | "no_action_needed" | "executed" | "executed_fallback" | "executed_testnet" | "aborted" | "dry_run_only" | "dry_run_rejected" | "failed" | "completed";

export interface VeniceDecision {
  analysis: string;
  action: AgentAction;
  params: Record<string, unknown>;
  confidence: number;
  risk_assessment: RiskLevel;
  reasoning_summary: string;
  model: string;
  provider: "venice";
  private: true;
  timestamp: string;
}

export interface RiskAssessment {
  risk_score: number;
  risk_level: RiskLevel;
  factors: string[];
  recommendation: RiskRecommendation;
  max_safe_amount: string;
  reasoning: string;
  model: string;
  provider: "bankr";
  task: "risk_assessment";
}

export interface MarketAnalysis {
  market_sentiment: MarketSentiment;
  eth_trend: "up" | "stable" | "down";
  steth_discount: string;
  swap_recommendation: SwapRecommendation;
  optimal_pairs: Array<{ from: string; to: string; reason: string }>;
  reasoning: string;
  model: string;
  provider: "bankr";
  task: "market_analysis";
}

export interface StrategyResult {
  action: AgentAction;
  urgency: Urgency;
  swap_amount: string | null;
  swap_path: string[] | null;
  slippage_tolerance: number;
  reasoning: string;
  expected_outcome: string;
  model: string;
  provider: "bankr";
  task: "strategy_synthesis";
}

// ── Lido / Treasury Types ─────────────────────────────────────

export interface TreasuryState {
  principal: string;
  availableYield: string;
  totalBalance: string;
  yieldWithdrawn: string;
  maxDailySpendBps: string;
  dailySpendRemaining: string;
  paused: boolean;
}

export interface BalancesResult {
  address: string;
  eth: string;
  stETH: string;
  wstETH: string;
  treasury?: TreasuryState;
}

export interface ProtocolStats {
  totalPooledEther: string;
  totalShares: string;
  stEthPerWstEth: string;
  exchangeRate: string;
}

export interface LidoOperationResult {
  action: string;
  txHash?: string;
  blockNumber?: number;
  timestamp?: string;
  dryRun?: boolean;
  [key: string]: unknown;
}

// ── Uniswap Types ─────────────────────────────────────────────

export interface SwapQuote {
  quote: unknown;
  amountOut: string;
  gasEstimate: string;
  route: unknown;
  priceImpact: string;
}

export interface SwapResult {
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  status: "success" | "failed";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  timestamp: string;
}

export interface DryRunResult {
  dryRun: true;
  wouldReceive: string;
  priceImpact: string;
  gasEstimate: string;
  route: unknown;
}

// ── Logger Types ──────────────────────────────────────────────

export interface CycleLogEntry {
  id?: string;
  did?: string;
  cycleId?: string;
  timestamp?: string;
  phase: CyclePhase;
  action: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  reasoning?: string | null;
  txHash?: string | null;
  provider?: string | null;
  model?: string | null;
  gasUsed?: string | null;
  duration?: number | null;
  status: CycleStatus;
}

export interface LoopLogEntry {
  loopId?: string;
  discover: CycleLogEntry;
  plan: CycleLogEntry;
  execute: CycleLogEntry;
  verify: CycleLogEntry;
}

export interface AgentLog {
  agent: string;
  version: string;
  did: string;
  operator: string;
  cycles: Array<CycleLogEntry | LoopLogEntry & { type: "autonomous_loop" }>;
}

// ── Config Types ──────────────────────────────────────────────

export interface AppConfig {
  agent: {
    name: string;
    version: string;
    did: string;
    apiKey: string;
  };
  venice: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
  };
  bankr: {
    baseUrl: string;
    apiKey: string;
    models: {
      risk: string;
      market: string;
      strategy: string;
    };
  };
  uniswap: {
    apiKey: string;
    baseUrl: string;
    routerAddress: string;
  };
  lido: {
    stETH: string;
    wstETH: string;
    withdrawalQueue: string;
  };
  treasury: {
    address: string;
    maxDailySpendBps: number;
  };
  registry: {
    address: string;
  };
  chain: {
    rpcUrl: string;
    chainId: number;
    agentPrivateKey: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  loop: {
    intervalMs: number;
    maxGasPerCycleGwei: number;
    computeBudgetUsd: number;
    minYieldThreshold: number;
  };
}

// ── Agent State ───────────────────────────────────────────────

export interface AgentState {
  running: boolean;
  cycleCount: number;
  totalYieldManaged: number;
  lastAction: AgentAction | null;
  computeSpentUsd: number;
  startedAt: string | null;
}

// ── Execute Result ────────────────────────────────────────────

export interface ExecuteResult {
  action: string;
  dryRun?: DryRunResult | LidoOperationResult;
  spend?: LidoOperationResult;
  swap?: LidoOperationResult;
  txHash?: string;
  status: CycleStatus;
  reason?: string;
  error?: string;
  riskScore?: number;
  router?: string;
  expectedOutput?: string;
}
