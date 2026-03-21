/**
 * Core API hook - fetches from the YieldsPilot API server with polling.
 * Falls back gracefully when API is unavailable.
 */
import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  refetch: () => void;
}

export function useApi<T>(
  endpoint: string,
  pollIntervalMs: number = 10_000,
  fallback?: T
): ApiState<T> {
  const [data, setData] = useState<T | null>(fallback ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setConnected(true);
        setError(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setConnected(false);
        setError(err instanceof Error ? err.message : "API unreachable");
        // Keep last good data or fallback
        if (!data && fallback) {
          setData(fallback);
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [endpoint, fallback]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, connected, refetch: fetchData };
}

// ── Typed Hooks ──────────────────────────────────────────────────

export interface TreasuryData {
  connected: boolean;
  address?: string;
  principal: string;
  availableYield: string;
  totalBalance: string;
  yieldWithdrawn: string;
  maxDailySpendBps: string;
  dailySpendRemaining: string;
  paused: boolean;
  owner?: string;
  agent?: string;
  network?: string;
  updatedAt?: string;
  error?: string;
}

export interface BalancesData {
  connected: boolean;
  address: string;
  eth: string;
  stETH: string;
  wstETH: string;
  network?: string;
  updatedAt?: string;
  error?: string;
}

export interface AgentStatusData {
  running: boolean;
  cycleCount: number;
  lastAction: string | null;
  computeSpentUsd: number;
  startedAt: string | null;
  uptimeMs: number;
  lastCycle: unknown;
  treasuryConnected: boolean;
  agentAddress: string;
  network: string;
  updatedAt: string;
}

export interface CycleLog {
  id?: string;
  cycleId?: string;
  timestamp?: string;
  phase: string;
  action: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  reasoning?: string | null;
  txHash?: string | null;
  provider?: string | null;
  model?: string | null;
  gasUsed?: string | null;
  duration?: number | null;
  status: string;
}

export interface LoopLog {
  loopId?: string;
  type?: string;
  discover: CycleLog;
  plan: CycleLog;
  execute: CycleLog;
  verify: CycleLog;
}

export interface AgentLogsData {
  agent: string;
  totalCycles: number;
  cycles: Array<CycleLog | LoopLog>;
  updatedAt: string;
}

export interface YieldHistoryData {
  history: Array<{ date: string; yield: number; balance: number; user?: string | null; cycle?: number | null }>;
  updatedAt: string;
}

export function useTreasury() {
  return useApi<TreasuryData>("/treasury", 15_000);
}

export function useBalances() {
  return useApi<BalancesData>("/balances", 15_000);
}

export function useAgentStatus() {
  return useApi<AgentStatusData>("/status", 5_000);
}

export function useAgentLogs(limit: number = 50) {
  return useApi<AgentLogsData>(`/logs?limit=${limit}`, 5_000);
}

export function useYieldHistory() {
  return useApi<YieldHistoryData>("/yield-history", 30_000);
}

// ── Multi-User Hooks ─────────────────────────────────────────────

export interface UserTreasuryState {
  address: string;
  principal: string;
  availableYield: string;
  totalBalance: string;
  yieldWithdrawn: string;
  maxDailySpendBps: string;
  dailySpendRemaining: string;
  paused: boolean;
  owner: string;
  agent: string;
}

export interface RegistryUser {
  user: string;
  treasury: string;
  state?: UserTreasuryState | null;
}

export interface RegistryData {
  connected: boolean;
  registryMode: boolean;
  registryAddress?: string;
  admin?: string;
  agent?: string;
  defaultMaxDailyBps?: string;
  paused?: boolean;
  treasuryCount: number;
  users: RegistryUser[];
  singleTreasury?: string | null;
  network?: string;
  updatedAt?: string;
  error?: string;
}

export interface UsersData {
  connected: boolean;
  registryMode: boolean;
  users: RegistryUser[];
  treasuryCount?: number;
  registryAddress?: string;
  updatedAt?: string;
}

export function useRegistry() {
  return useApi<RegistryData>("/registry", 15_000);
}

export function useUsers() {
  return useApi<UsersData>("/users", 15_000);
}

// ── Activity & Token Hooks ──────────────────────────────────────

export interface TokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
}

export interface TreasuryTokensData {
  address: string;
  tokens: TokenBalance[];
  eth: string;
  updatedAt: string;
}

export interface ActivityRecordData {
  id: string;
  cycle: number;
  timestamp: string;
  user: string;
  treasuryAddress: string;
  action: string;
  status: string;
  treasuryBalance: string;
  principal: string;
  availableYield: string;
  dailySpendRemaining: string;
  veniceAction: string;
  veniceReasoning: string;
  riskLevel: string;
  riskScore: number;
  marketSentiment: string;
  finalAction: string;
  strategyReasoning: string;
  swapAmount?: string;
  tokenIn?: string;
  tokenOut?: string;
  swapPath?: string[];
  txHash?: string;
  router?: string;
  expectedOutput?: string;
  executionMode?: string;
  durationMs: number;
  error?: string;
}

export interface ActivityData {
  records: ActivityRecordData[];
  total: number;
  stats: {
    totalCycles: number;
    totalSwaps: number;
    totalHolds: number;
    totalErrors: number;
    totalVolumeStETH: number;
    lastUpdated: string;
  };
  updatedAt: string;
}

export function useTreasuryTokens(address: string | undefined) {
  return useApi<TreasuryTokensData>(
    address ? `/treasury-tokens/${address}` : "/treasury-tokens/0x0",
    15_000
  );
}

export function useActivity(limit: number = 50) {
  return useApi<ActivityData>(`/activity?limit=${limit}`, 10_000);
}
