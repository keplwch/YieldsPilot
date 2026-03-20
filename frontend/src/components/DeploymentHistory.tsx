import { History, ArrowRightLeft, Pause, AlertTriangle, ExternalLink } from "lucide-react";

export interface ActivityRecord {
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

interface DeploymentHistoryProps {
  records: ActivityRecord[];
  total: number;
  stats: {
    totalCycles: number;
    totalSwaps: number;
    totalHolds: number;
    totalErrors: number;
    totalVolumeStETH: number;
  };
}

const actionConfig: Record<string, { bg: string; text: string; border: string; icon: typeof ArrowRightLeft; label: string }> = {
  swap_yield: { bg: "rgba(0,229,160,0.08)", text: "#00e5a0", border: "rgba(0,229,160,0.22)", icon: ArrowRightLeft, label: "SWAP" },
  hold: { bg: "rgba(99,102,241,0.08)", text: "#818cf8", border: "rgba(99,102,241,0.22)", icon: Pause, label: "HOLD" },
  abort: { bg: "rgba(244,63,94,0.08)", text: "#f43f5e", border: "rgba(244,63,94,0.22)", icon: AlertTriangle, label: "ABORT" },
  error: { bg: "rgba(244,63,94,0.06)", text: "#f43f5e", border: "rgba(244,63,94,0.18)", icon: AlertTriangle, label: "ERROR" },
  skip_paused: { bg: "rgba(245,158,11,0.08)", text: "#f59e0b", border: "rgba(245,158,11,0.22)", icon: Pause, label: "SKIP" },
  skip_no_yield: { bg: "rgba(100,116,139,0.08)", text: "#64748b", border: "rgba(100,116,139,0.22)", icon: Pause, label: "SKIP" },
};

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HistoryRow({ record, index }: { record: ActivityRecord; index: number }) {
  const cfg = actionConfig[record.action] ?? actionConfig.hold;
  const Icon = cfg.icon;

  return (
    <div
      className="flex items-start gap-4 px-6 py-4 border-b transition-colors hover:bg-white/[0.01] animate-slide-in"
      style={{ borderColor: "rgba(99,102,241,0.07)", animationDelay: `${index * 0.02}s` }}
    >
      {/* Action badge */}
      <div className="flex-shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center"
        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
        <Icon size={13} style={{ color: cfg.text }} strokeWidth={2} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] px-1.5 py-0.5 font-mono font-bold tracking-widest"
            style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
          <span className="text-[11px] font-mono text-text-muted">Cycle #{record.cycle}</span>
          {record.executionMode && record.executionMode !== "none" && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 text-text-muted"
              style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.1)" }}>
              {record.executionMode.replace("_", " ").toUpperCase()}
            </span>
          )}
        </div>

        {/* Swap details */}
        {record.action === "swap_yield" && record.swapAmount && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-mono font-semibold text-text-primary tabular-nums">
              {parseFloat(record.swapAmount).toFixed(4)}
            </span>
            <span className="text-[11px] text-text-muted font-mono">{record.tokenIn ?? "stETH"}</span>
            <span className="text-[10px] text-text-muted">→</span>
            <span className="text-[11px] font-mono" style={{ color: "#2775ca" }}>{record.tokenOut ?? "USDC"}</span>
            {record.status === "executed" && (
              <span className="text-[9px] font-mono px-1 py-px" style={{ background: "rgba(0,229,160,0.08)", color: "#00e5a0", border: "1px solid rgba(0,229,160,0.18)" }}>
                SUCCESS
              </span>
            )}
            {record.status === "failed" && (
              <span className="text-[9px] font-mono px-1 py-px" style={{ background: "rgba(244,63,94,0.08)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.18)" }}>
                FAILED
              </span>
            )}
          </div>
        )}

        {/* Reasoning summary */}
        <div className="text-[11px] text-text-secondary leading-relaxed font-body">
          <span className="text-text-muted">Venice:</span> {record.veniceAction}
          <span className="text-text-muted mx-1">→</span>
          <span className="text-text-muted">Risk:</span> {record.riskLevel}
          <span className="text-text-muted mx-1">→</span>
          <span className="text-text-muted">Final:</span> {record.finalAction}
        </div>
        <div className="text-[10px] text-text-muted mt-1 line-clamp-1 font-body">
          {record.strategyReasoning || record.veniceReasoning || "—"}
        </div>

        {/* Tx hash */}
        {record.txHash && (
          <a
            href={`https://sepolia.etherscan.io/tx/${record.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-mono text-text-muted hover:text-accent-purple transition-colors"
          >
            <ExternalLink size={9} />
            {record.txHash.slice(0, 10)}...{record.txHash.slice(-6)}
          </a>
        )}
      </div>

      {/* Right side: time + duration */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-[10px] text-text-muted font-mono">{timeAgo(record.timestamp)}</span>
        <span className="text-[9px] text-text-muted font-mono">{(record.durationMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

export default function DeploymentHistory({ records, total, stats }: DeploymentHistoryProps) {
  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <History size={12} style={{ color: "#f59e0b" }} strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Yield Deployment History</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono px-1.5 py-0.5"
                style={{ background: "rgba(0,229,160,0.08)", color: "#00e5a0", border: "1px solid rgba(0,229,160,0.18)" }}>
                {stats.totalSwaps} swaps
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5"
                style={{ background: "rgba(99,102,241,0.08)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.18)" }}>
                {stats.totalHolds} holds
              </span>
              {stats.totalErrors > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5"
                  style={{ background: "rgba(244,63,94,0.08)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.18)" }}>
                  {stats.totalErrors} errors
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-text-muted">{total} total</span>
          </div>
        </div>

        {/* Stats bar */}
        {stats.totalCycles > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: "rgba(99,102,241,0.07)" }}>
            <div className="flex items-center gap-4">
              <div className="text-[10px] font-mono text-text-muted">
                Volume: <span className="text-accent-green font-semibold">{stats.totalVolumeStETH.toFixed(4)} stETH</span>
              </div>
              <div className="text-[10px] font-mono text-text-muted">
                Success rate: <span className="text-text-primary font-semibold">
                  {stats.totalSwaps > 0 ? ((stats.totalSwaps / (stats.totalSwaps + stats.totalErrors)) * 100).toFixed(0) : "—"}%
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="max-h-[600px] overflow-y-auto">
          {records.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-[11px] font-mono text-text-muted">No activity recorded yet — waiting for agent cycles</div>
            </div>
          ) : (
            records.map((record, i) => (
              <HistoryRow key={record.id} record={record} index={i} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
