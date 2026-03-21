import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
import type { YieldChartBar } from "../data/transformers";

interface YieldChartProps {
  data: YieldChartBar[];
}

// Assign a consistent color per user address slot
const USER_COLORS = [
  { fill: "#6366f1", label: "indigo" },   // primary purple
  { fill: "#00e5a0", label: "green" },    // accent green
  { fill: "#06b6d4", label: "cyan" },     // accent blue
  { fill: "#f59e0b", label: "amber" },    // accent orange
  { fill: "#f43f5e", label: "rose" },     // accent red
];

export default function YieldChart({ data }: YieldChartProps) {
  const bars = data;
  const isEmpty = bars.length === 0;

  // Collect all unique users in stable order
  const users = useMemo(() => {
    const seen = new Set<string>();
    for (const b of bars) for (const s of b.segments) seen.add(s.user);
    return Array.from(seen);
  }, [bars]);

  const maxTotal = useMemo(() => Math.max(...bars.map((b) => b.total), 0.0001), [bars]);
  const latestTotal = bars[bars.length - 1]?.total;
  const totalCycles = bars.length;
  const multiUser = users.length > 1;

  const fmt = (addr: string) =>
    addr === "unknown" ? "unknown" : `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div className="card-wrap h-full">
      <div className="card-body h-full flex flex-col">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.2)" }}>
              <TrendingUp size={12} className="text-accent-green" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">
              Yield Accrual
              <span className="text-text-muted font-mono font-normal text-[10px] ml-1.5">
                ({totalCycles} cycle{totalCycles !== 1 ? "s" : ""})
              </span>
            </span>
          </div>
          {latestTotal !== undefined && (
            <span className="text-[11px] font-mono text-accent-green tabular-nums">
              +{latestTotal.toFixed(4)} stETH
            </span>
          )}
        </div>

        <div className="flex-1 flex flex-col px-4 pb-4 pt-2 min-h-0">
          {isEmpty ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-text-muted font-mono">
              No yield data yet
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Bars */}
              <div className="flex-1 flex items-end gap-[3px] min-h-0">
                {bars.map((bar, bi) => {
                  const isLast = bi === bars.length - 1;
                  const heightPct = (bar.total / maxTotal) * 100;

                  return (
                    <div
                      key={bar.cycle}
                      className="flex-1 flex flex-col-reverse relative group cursor-default"
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    >
                      {/* Stacked segments, bottom to top */}
                      {bar.segments.map((seg, si) => {
                        const userIdx = users.indexOf(seg.user) % USER_COLORS.length;
                        const color = USER_COLORS[userIdx];
                        const segPct = bar.total > 0 ? (seg.yield / bar.total) * 100 : 100;
                        return (
                          <div
                            key={seg.user}
                            style={{
                              height: `${segPct}%`,
                              background: color.fill,
                              opacity: isLast ? 1 : (0.35 + (bi / Math.max(bars.length - 1, 1)) * 0.5),
                              boxShadow: isLast && si === bar.segments.length - 1
                                ? `0 0 8px ${color.fill}66`
                                : "none",
                            }}
                          />
                        );
                      })}

                      {/* Tooltip */}
                      <div
                        className="hidden group-hover:flex flex-col gap-0.5 absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-2 z-20 pointer-events-none whitespace-nowrap"
                        style={{
                          background: "#090916",
                          border: "1px solid rgba(99,102,241,0.3)",
                          minWidth: "110px",
                        }}
                      >
                        <span className="text-[9px] text-text-muted font-mono mb-0.5">
                          Cycle #{bar.cycle}
                        </span>
                        {bar.segments.map((seg) => {
                          const color = USER_COLORS[users.indexOf(seg.user) % USER_COLORS.length];
                          return (
                            <div key={seg.user} className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color.fill }} />
                              <span className="text-[9px] font-mono text-text-secondary">
                                {fmt(seg.user)}: {seg.yield.toFixed(4)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="mt-0.5 pt-0.5 border-t border-white/5 text-[9px] font-mono text-text-primary tabular-nums">
                          Total: {bar.total.toFixed(4)} stETH
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* X-axis: first / last cycle labels */}
              <div className="flex justify-between mt-2 flex-shrink-0">
                <span className="text-[9px] text-text-muted font-mono">
                  #{bars[0]?.cycle}
                </span>
                <span className="text-[9px] text-text-muted font-mono">
                  #{bars[bars.length - 1]?.cycle}
                </span>
              </div>

              {/* Legend — only when multi-user */}
              {multiUser && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 flex-shrink-0">
                  {users.map((u, i) => {
                    const color = USER_COLORS[i % USER_COLORS.length];
                    return (
                      <div key={u} className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color.fill }} />
                        <span className="text-[9px] font-mono text-text-muted">{fmt(u)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
