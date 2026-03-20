interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  change?: string;
  positive?: boolean;
  gradient?: boolean;
  delay?: number;
}

export default function StatCard({ label, value, sub, change, positive = true, delay = 0 }: StatCardProps) {
  return (
    <div
      className="stat-wrap animate-slide-in transition-transform duration-200 hover:-translate-y-px"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="stat-body p-6">
        <div className="text-[10px] text-text-muted uppercase tracking-[2.5px] font-mono mb-4">
          {label}
        </div>
        <div className="font-display text-[28px] font-bold leading-none mb-2 text-text-primary tabular-nums">
          {value}
        </div>
        <div className="text-[11px] text-text-muted font-mono">{sub}</div>

        {/* Always reserve space for the badge row so all cards align vertically */}
        <div className="mt-3 h-[22px] flex items-center">
          {change ? (
            <div
              className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 ${
                positive
                  ? "text-accent-green border border-accent-green/20 bg-accent-green/5"
                  : "text-accent-red border border-accent-red/20 bg-accent-red/5"
              }`}
            >
              <span>{positive ? "▲" : "▼"}</span>
              {change}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
