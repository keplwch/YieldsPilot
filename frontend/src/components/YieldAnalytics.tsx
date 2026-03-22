import { BarChart3 } from "lucide-react";
import type { ActivityRecord } from "./DeploymentHistory";

interface YieldAnalyticsProps {
  records: ActivityRecord[];
  stats: {
    totalCycles: number;
    totalSwaps: number;
    totalHolds: number;
    totalErrors: number;
    totalVolumeStETH: number;
  };
}

export default function YieldAnalytics({ records, stats }: YieldAnalyticsProps) {
  // Build cumulative volume over time
  const swapRecords = records
    .filter(r => r.action === "swap_yield" && r.status === "executed")
    .reverse(); // oldest first for cumulative

  let cumulative = 0;
  const volumePoints = swapRecords.map(r => {
    cumulative += parseFloat(r.swapAmount ?? "0");
    return { time: r.timestamp, volume: cumulative, amount: parseFloat(r.swapAmount ?? "0") };
  });

  // Per-token breakdown
  const tokenBreakdown: Record<string, number> = {};
  for (const r of swapRecords) {
    const token = r.tokenOut ?? "USDC";
    tokenBreakdown[token] = (tokenBreakdown[token] ?? 0) + parseFloat(r.swapAmount ?? "0");
  }
  const tokenEntries = Object.entries(tokenBreakdown).sort((a, b) => b[1] - a[1]);
  const tokenTotal = tokenEntries.reduce((s, [, v]) => s + v, 0);

  // Action distribution for pie
  const actionDist = [
    { label: "Swaps", count: stats.totalSwaps, color: "#00e5a0" },
    { label: "Holds", count: stats.totalHolds, color: "#6366f1" },
    { label: "Errors", count: stats.totalErrors, color: "#f43f5e" },
  ].filter(a => a.count > 0);
  const actionTotal = actionDist.reduce((s, a) => s + a.count, 0);

  // SVG chart dimensions
  const W = 320;
  const H = 120;
  const PAD = 24;

  // Build cumulative volume SVG path
  let volumePath = "";
  let areaPath = "";
  if (volumePoints.length > 1) {
    const maxVol = Math.max(...volumePoints.map(p => p.volume), 0.001);
    const points = volumePoints.map((p, i) => {
      const x = PAD + (i / (volumePoints.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((p.volume / maxVol) * (H - PAD * 2));
      return { x, y };
    });
    volumePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    areaPath = volumePath + ` L ${points[points.length - 1].x.toFixed(1)} ${H - PAD} L ${points[0].x.toFixed(1)} ${H - PAD} Z`;
  }

  if (stats.totalCycles === 0) {
    return (
      <div className="card-wrap">
        <div className="card-body">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <BarChart3 size={12} style={{ color: "#06b6d4" }} strokeWidth={2} />
              </div>
              <span className="text-[13px] font-display font-semibold text-text-primary">Yield Analytics</span>
            </div>
          </div>
          <div className="px-6 py-10 text-center">
            <div className="text-[11px] font-mono text-text-muted">Analytics will appear after agent cycles complete</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
              <BarChart3 size={12} style={{ color: "#06b6d4" }} strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Yield Analytics</span>
          </div>
        </div>

        <div className="p-6">
          {/* Cumulative Volume Chart */}
          {volumePoints.length > 1 && (
            <div className="mb-6">
              <div className="text-[10px] text-text-muted uppercase tracking-[2px] font-mono mb-3">Cumulative Swap Volume</div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "120px" }}>
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(pct => (
                  <line
                    key={pct}
                    x1={PAD} y1={H - PAD - pct * (H - PAD * 2)}
                    x2={W - PAD} y2={H - PAD - pct * (H - PAD * 2)}
                    stroke="rgba(99,102,241,0.08)" strokeWidth="0.5"
                  />
                ))}
                {/* Area fill */}
                <path d={areaPath} fill="rgba(0,229,160,0.06)" />
                {/* Line */}
                <path d={volumePath} fill="none" stroke="#00e5a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* End dot */}
                {volumePoints.length > 0 && (() => {
                  const maxVol = Math.max(...volumePoints.map(p => p.volume), 0.001);
                  const last = volumePoints[volumePoints.length - 1];
                  const x = PAD + ((volumePoints.length - 1) / (volumePoints.length - 1)) * (W - PAD * 2);
                  const y = H - PAD - ((last.volume / maxVol) * (H - PAD * 2));
                  return <circle cx={x} cy={y} r="3" fill="#00e5a0" />;
                })()}
                {/* Value label */}
                <text x={W - PAD} y={12} textAnchor="end" fill="#00e5a0" fontSize="10" fontFamily="monospace">
                  {cumulative.toFixed(8)} stETH
                </text>
              </svg>
            </div>
          )}

          {/* Action Distribution */}
          <div className="mb-6">
            <div className="text-[10px] text-text-muted uppercase tracking-[2px] font-mono mb-3">Action Distribution</div>
            {/* Horizontal bar */}
            <div className="flex h-2.5 rounded-sm overflow-hidden gap-px mb-3">
              {actionDist.map(a => (
                <div
                  key={a.label}
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${(a.count / actionTotal) * 100}%`,
                    backgroundColor: a.color,
                    minWidth: "4px",
                  }}
                />
              ))}
            </div>
            <div className="flex items-center gap-4">
              {actionDist.map(a => (
                <div key={a.label} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 flex-shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[10px] font-mono text-text-secondary">
                    {a.label} {((a.count / actionTotal) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-Token Breakdown */}
          {tokenEntries.length > 0 && (
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-[2px] font-mono mb-3">Yield Deployed By Token</div>
              <div className="flex flex-col gap-2.5">
                {tokenEntries.map(([token, vol]) => (
                  <div key={token}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono text-text-primary">→ {token}</span>
                      <span className="text-[11px] font-mono text-text-secondary tabular-nums">{vol.toFixed(8)} stETH</span>
                    </div>
                    <div className="h-1.5 rounded-sm overflow-hidden" style={{ background: "rgba(99,102,241,0.06)" }}>
                      <div
                        className="h-full transition-all duration-700"
                        style={{
                          width: `${(vol / tokenTotal) * 100}%`,
                          backgroundColor: token === "USDC" ? "#2775ca" : "#00e5a0",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
