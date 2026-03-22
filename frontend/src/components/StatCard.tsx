interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  change?: string;
  positive?: boolean;
  gradient?: boolean;
  delay?: number;
  accentColor?: string;
}

export default function StatCard({
  label,
  value,
  sub,
  change,
  positive = true,
  delay = 0,
  accentColor,
}: StatCardProps) {
  // Derive accent color from context: green for yield/positive, purple default
  const accent = accentColor ?? (positive && change ? "#00e5a0" : "#6366f1");

  return (
    <div
      className="stat-wrap animate-slide-in transition-transform duration-200 hover:-translate-y-px"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="stat-body p-5 relative overflow-hidden">
        {/* Left accent bar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[2px] transition-opacity duration-300"
          style={{ background: accent, opacity: 0.5 }}
        />

        {/* Top row: label */}
        <div className="text-[9px] text-text-muted uppercase tracking-[3px] font-mono mb-3 pl-3">
          {label}
        </div>

        {/* Value */}
        <div className="font-display text-[26px] font-bold leading-none mb-2.5 text-text-primary tabular-nums pl-3 tracking-tight">
          {value}
        </div>

        {/* Sub + change inline */}
        <div className="pl-3 flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-muted font-mono truncate">{sub}</span>
          {change && (
            <span
              className="text-[9px] font-mono font-semibold shrink-0 tabular-nums"
              style={{ color: positive ? "#00e5a0" : "#f43f5e" }}
            >
              {change}
            </span>
          )}
        </div>

        {/* Bottom accent line — proportion indicator */}
        <div className="mt-4 h-[1px] ml-3 mr-0" style={{ background: "rgba(99,102,241,0.08)" }}>
          <div
            className="h-full transition-all duration-700"
            style={{
              width: positive && change ? "60%" : "30%",
              background: accent,
              opacity: 0.4,
            }}
          />
        </div>
      </div>
    </div>
  );
}
