import { TrendingUp } from "lucide-react";

interface YieldChartProps {
  data: number[];
}

export default function YieldChart({ data }: YieldChartProps) {
  const max = data.length > 0 ? Math.max(...data) : 1;
  const days = data.length;

  const now = new Date();
  const startDate = new Date(now.getTime() - (days - 1) * 86400000);
  const midDate = new Date(now.getTime() - Math.floor(days / 2) * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const latestVal = data[data.length - 1];

  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.2)" }}>
              <TrendingUp size={12} className="text-accent-green" strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">
              Yield Accrual
              <span className="text-text-muted font-mono font-normal text-[10px] ml-1.5">({days}d)</span>
            </span>
          </div>
          {latestVal !== undefined && (
            <span className="text-[11px] font-mono text-accent-green tabular-nums">+{latestVal.toFixed(4)} stETH</span>
          )}
        </div>

        <div className="p-6">
          {/* Bars */}
          <div className="flex items-end gap-1 h-[108px]">
            {data.map((val, i) => {
              const height = max > 0 ? Math.max((val / max) * 100, 2) : 2;
              const isLast = i === data.length - 1;
              const progress = i / Math.max(data.length - 1, 1);
              return (
                <div key={i} className="flex-1 relative group transition-all duration-500 cursor-pointer hover:brightness-125"
                  style={{
                    height: `${height}%`,
                    background: isLast ? "#6366f1" : `rgba(99,102,241,${0.10 + progress * 0.40})`,
                    boxShadow: isLast ? "0 0 10px rgba(99,102,241,0.4)" : "none",
                  }}>
                  <div className="hidden group-hover:block absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-mono whitespace-nowrap z-10 pointer-events-none"
                    style={{ background: "#090916", border: "1px solid rgba(99,102,241,0.3)", color: "#e2e8f0" }}>
                    {val.toFixed(4)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2.5 text-[9px] text-text-muted font-mono">
            <span>{fmt(startDate)}</span>
            <span>{fmt(midDate)}</span>
            <span>{fmt(now)}</span>
          </div>
          <div className="mt-1 h-px" style={{ background: "rgba(99,102,241,0.08)" }} />
        </div>
      </div>
    </div>
  );
}
