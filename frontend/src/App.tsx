import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import Header from "./components/Header";
import StatCard from "./components/StatCard";
import ReasoningPanel from "./components/ReasoningPanel";
import ActivityFeed from "./components/ActivityFeed";
import TreasuryRing from "./components/TreasuryRing";
import YieldChart from "./components/YieldChart";
import ConnectionBanner from "./components/ConnectionBanner";
import UserList from "./components/UserList";
import DepositPanel from "./components/DepositPanel";
import WstETHDepositPanel from "./components/WstETHDepositPanel";
import TreasuryManagement from "./components/TreasuryManagement";
import TokenPortfolio from "./components/TokenPortfolio";
import DeploymentHistory from "./components/DeploymentHistory";
import YieldAnalytics from "./components/YieldAnalytics";
import { useAnimatedValue } from "./hooks/useAnimatedValue";
import {
  useTreasury,
  useAgentStatus,
  useAgentLogs,
  useYieldHistory,
  useUsers,
  useTreasuryTokens,
  useActivity,
} from "./hooks/useApi";
import { logsToFeedItems, logsToReasoningLines, apiYieldToChartData, getCycleTimestamp } from "./data/transformers";
import type { CycleOption } from "./components/CycleNav";

export default function App() {
  const { address: connectedAddress } = useAccount();

  // ── Fetch real data from API ─────────────────────────────────
  const treasury = useTreasury();
  const status = useAgentStatus();
  const logs = useAgentLogs();
  const yieldHist = useYieldHistory();
  const usersApi = useUsers();
  const activityApi = useActivity(100);

  const apiConnected = treasury.connected || status.connected;

  // ── Multi-user state ──────────────────────────────────────────
  const registryMode = (status.data as any)?.registryMode ?? false;
  const registryAddress = (status.data as any)?.registryAddress ?? (treasury.data as any)?.registryAddress ?? "";
  const users = usersApi.data?.users ?? [];
  const totalUsers = users.length;

  // Get the first treasury address for token balance queries
  const firstTreasuryAddress = useMemo(() => {
    if (users.length > 0 && users[0].treasury) return users[0].treasury;
    return (treasury.data as any)?.address ?? undefined;
  }, [users, treasury.data]);

  // Get the CONNECTED wallet's treasury (for TreasuryManagement ownership)
  const connectedUserTreasury = useMemo(() => {
    if (!connectedAddress) return firstTreasuryAddress;
    const match = users.find(
      (u) => u.user?.toLowerCase() === connectedAddress.toLowerCase()
    );
    if (match?.treasury) return match.treasury;
    // Fallback: single-user mode or no match
    return (treasury.data as any)?.address ?? firstTreasuryAddress;
  }, [connectedAddress, users, treasury.data, firstTreasuryAddress]);

  const treasuryTokens = useTreasuryTokens(connectedUserTreasury);

  // ── Aggregate stats across all users ──────────────────────────
  const aggregateStats = useMemo(() => {
    if (users.length === 0) {
      // Fallback to single treasury data
      return {
        totalBalance: parseFloat(treasury.data?.totalBalance ?? "0"),
        principal: parseFloat(treasury.data?.principal ?? "0"),
        availableYield: parseFloat(treasury.data?.availableYield ?? "0"),
        yieldWithdrawn: parseFloat(treasury.data?.yieldWithdrawn ?? "0"),
        maxDailySpendBps: treasury.data?.maxDailySpendBps ?? "0",
      };
    }

    let totalBalance = 0;
    let principal = 0;
    let availableYield = 0;
    let yieldWithdrawn = 0;

    for (const u of users) {
      if (u.state) {
        totalBalance += parseFloat(u.state.totalBalance ?? "0");
        principal += parseFloat(u.state.principal ?? "0");
        availableYield += parseFloat(u.state.availableYield ?? "0");
        yieldWithdrawn += parseFloat(u.state.yieldWithdrawn ?? "0");
      }
    }

    return {
      totalBalance,
      principal,
      availableYield,
      yieldWithdrawn,
      maxDailySpendBps: treasury.data?.maxDailySpendBps ?? "5000",
    };
  }, [users, treasury.data]);

  const totalDisplay = useAnimatedValue(aggregateStats.totalBalance);
  const yieldDisplay = useAnimatedValue(aggregateStats.availableYield);

  const cycleCount = status.data?.cycleCount ?? 0;
  const usersProcessed = (status.data as any)?.usersProcessed ?? 0;

  // ── Cycle navigation ──────────────────────────────────────────
  // null = auto-follow latest; number = pinned to that option index
  const [pinnedCycleIdx, setPinnedCycleIdx] = useState<number | null>(null);

  const rawCycles = logs.data?.cycles ?? [];
  // Filter cycles to connected wallet only, then keep loop entries
  const loopCycles = useMemo(() => {
    return rawCycles.filter((c) => {
      if (!((c as any).type === "autonomous_loop" || (c as any).phases != null)) return false;
      // When a wallet is connected, show only that user's cycles
      if (connectedAddress) {
        const cycleUser = (c as any).phases?.discover?.inputs?.user as string | undefined;
        if (cycleUser && cycleUser.toLowerCase() !== connectedAddress.toLowerCase()) return false;
      }
      return true;
    });
  }, [rawCycles, connectedAddress]);

  const cycleOptions: CycleOption[] = useMemo(() => {
    return loopCycles.map((cycle, i) => {
      const ts = getCycleTimestamp(cycle);
      let timeAgo = "—";
      if (ts) {
        const diff = Date.now() - new Date(ts).getTime();
        const secs = Math.floor(diff / 1000);
        if (secs < 5) timeAgo = "just now";
        else if (secs < 60) timeAgo = `${secs}s ago`;
        else if (secs < 3600) timeAgo = `${Math.floor(secs / 60)}m ago`;
        else timeAgo = `${Math.floor(secs / 3600)}h ago`;
      }
      // Use the cycle number stored in the DB record; fall back to array index
      const cycleNum = (cycle as any).cycleNumber ?? (i + 1);
      return { index: i, label: `Cycle #${cycleNum}`, timeAgo };
    });
  }, [loopCycles]);

  // Effective option index — clamp when cycles array grows
  const effectiveOptIdx = useMemo(() => {
    if (cycleOptions.length === 0) return 0;
    if (pinnedCycleIdx === null) return cycleOptions.length - 1;
    return Math.min(pinnedCycleIdx, cycleOptions.length - 1);
  }, [pinnedCycleIdx, cycleOptions.length]);

  const isLive = pinnedCycleIdx === null;

  const selectedCycle = loopCycles[effectiveOptIdx] ?? null;

  // ── Transform logs → UI components ───────────────────────────
  const feedItems = useMemo(() => {
    if (!selectedCycle) return [];
    return logsToFeedItems([selectedCycle]);
  }, [selectedCycle]);

  const reasoning = useMemo(() => {
    if (!selectedCycle) return [];
    return logsToReasoningLines([selectedCycle]);
  }, [selectedCycle]);

  const yieldChartData = useMemo(() => {
    return apiYieldToChartData(yieldHist.data?.history);
  }, [yieldHist.data]);

  // ── Activity data — scoped to connected wallet ───────────────
  const activityRecords = useMemo(() => {
    const all = activityApi.data?.records ?? [];
    if (!connectedAddress) return all;
    return all.filter((r) => r.user?.toLowerCase() === connectedAddress.toLowerCase());
  }, [activityApi.data, connectedAddress]);
  const activityTotal = activityRecords.length;
  const activityStats = activityApi.data?.stats ?? {
    totalCycles: 0,
    totalSwaps: 0,
    totalHolds: 0,
    totalErrors: 0,
    totalVolumeStETH: 0,
  };

  return (
    <div className="relative z-[1]">
      {/* Atmospheric background glows — body level, not on cards */}
      <div className="glow-top" />
      <div className="glow-br" />
      <div className="glow-tl" />
      <Header
        cycleCount={cycleCount}
        connected={apiConnected}
        running={status.data?.running ?? false}
      />

      <ConnectionBanner connected={apiConnected} network={(treasury.data as any)?.network} />

      {/* Hero Stats */}
      <section className="max-w-[1360px] mx-auto px-8 pt-10 pb-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="text-[10px] text-text-muted uppercase tracking-[3px] font-mono">
            Treasury Overview
          </div>
          {registryMode && totalUsers > 0 && (
            <span className="text-[10px] font-mono px-2.5 py-0.5"
              style={{
                background: "rgba(0,229,160,0.08)",
                border: "1px solid rgba(0,229,160,0.18)",
                color: "#00e5a0",
              }}>
              {totalUsers} user{totalUsers !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard
            label={registryMode ? "Total TVL" : "Total Balance"}
            value={totalDisplay}
            sub="stETH"
            change={
              apiConnected
                ? aggregateStats.totalBalance > 0
                  ? registryMode
                    ? `${totalUsers} user${totalUsers !== 1 ? "s" : ""} • Live`
                    : "Live"
                  : "No stETH deposited yet"
                : "Connecting..."
            }
            positive={aggregateStats.totalBalance > 0}
            gradient={aggregateStats.totalBalance > 0}
            delay={0}
          />
          <StatCard
            label="Locked Principal"
            value={aggregateStats.principal.toFixed(6)}
            sub={registryMode ? `stETH — across ${totalUsers} treasuries` : "stETH — untouchable by agent"}
            delay={0.1}
          />
          <StatCard
            label="Available Yield"
            value={yieldDisplay}
            sub="stETH — agent spendable"
            change={
              apiConnected && aggregateStats.maxDailySpendBps
                ? `Max daily: ${(parseInt(aggregateStats.maxDailySpendBps) / 100).toFixed(0)}%`
                : ""
            }
            positive={aggregateStats.availableYield > 0}
            gradient={aggregateStats.availableYield > 0}
            delay={0.2}
          />
          <StatCard
            label="Yield Deployed"
            value={aggregateStats.yieldWithdrawn.toFixed(6)}
            sub="stETH swapped via Uniswap"
            change={
              cycleCount > 0
                ? registryMode
                  ? `${cycleCount} cycles • ${usersProcessed} users`
                  : `${cycleCount} cycles`
                : ""
            }
            positive={aggregateStats.yieldWithdrawn > 0}
            delay={0.3}
          />
        </div>
      </section>

      {/* Main Grid */}
      <div className="max-w-[1360px] mx-auto px-8 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
          {/* Left column */}
          <div>
            <ReasoningPanel
              lines={reasoning}
              cycleOptions={cycleOptions}
              selectedCycleIndex={effectiveOptIdx}
              isLive={isLive}
              onCycleSelect={setPinnedCycleIdx}
              onGoLive={() => setPinnedCycleIdx(null)}
            />
            <ActivityFeed
              items={feedItems}
              cycleOptions={cycleOptions}
              selectedCycleIndex={effectiveOptIdx}
              isLive={isLive}
              onCycleSelect={setPinnedCycleIdx}
              onGoLive={() => setPinnedCycleIdx(null)}
            />

            {/* Analytics mini-row: ring + chart side by side */}
            <div className="mt-5 grid grid-cols-2 gap-5 items-stretch">
              <TreasuryRing
                principal={aggregateStats.principal}
                yieldAvailable={aggregateStats.availableYield}
                yieldDeployed={aggregateStats.yieldWithdrawn}
              />
              <YieldChart data={yieldChartData} />
            </div>

            {/* Yield Analytics — cumulative volume + distribution charts */}
            <div className="mt-5">
              <YieldAnalytics
                records={activityRecords}
                stats={activityStats}
              />
            </div>

            {/* Yield Deployment History — full activity log with all cycles */}
            <div className="mt-5">
              <DeploymentHistory
                records={activityRecords}
                total={activityTotal}
                stats={activityStats}
              />
            </div>

            {/* Multi-user list (below deployment history) */}
            {(registryMode || users.length > 0) && (
              <div className="mt-5">
                <UserList
                  users={users}
                  registryMode={registryMode}
                  registryAddress={registryAddress}
                />
              </div>
            )}
          </div>

          {/* Right sidebar — focused action panel */}
          <div className="flex flex-col gap-5">
            {/* Deposit panel — always first so it's always visible */}
            <DepositPanel
              registryAddress={registryAddress}
              registryMode={registryMode}
            />

            {/* wstETH Deposit panel — unwraps wstETH → stETH into treasury */}
            <WstETHDepositPanel
              registryAddress={registryAddress}
            />

            {/* Treasury Management — owner controls for withdraw, targets, settings */}
            <TreasuryManagement
              treasuryAddress={connectedUserTreasury}
            />

            {/* Token Portfolio — shows all tokens the treasury holds */}
            {connectedUserTreasury && treasuryTokens.data && (
              <TokenPortfolio
                tokens={treasuryTokens.data.tokens}
                ethBalance={treasuryTokens.data.eth}
                treasuryAddress={connectedUserTreasury}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
