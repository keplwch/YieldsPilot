import { Vault } from "lucide-react";

interface TreasuryRingProps {
  principal: number;
  yieldAvailable: number;
  yieldDeployed: number;
}

export default function TreasuryRing({ principal, yieldAvailable, yieldDeployed }: TreasuryRingProps) {
  const total = principal + yieldAvailable;
  const principalPct = total > 0 ? (principal / total) * 100 : 100;
  const yieldPct = total > 0 ? (yieldAvailable / total) * 100 : 0;

  const principalCircumference = 2 * Math.PI * 72;
  const yieldCircumference = 2 * Math.PI * 54;
  const principalOffset = principalCircumference * (1 - principalPct / 100);
  const yieldOffset = yieldCircumference * (1 - yieldPct / 100);

  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Vault size={12} className="text-accent-purple" strokeWidth={1.75} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Treasury Split</span>
          </div>
        </div>

        <div className="p-6">
          {/* SVG Ring - solid colors */}
          <div className="relative w-[176px] h-[176px] mx-auto mb-6">
            <svg width="176" height="176" viewBox="0 0 176 176" className="-rotate-90">
              <circle cx="88" cy="88" r="72" fill="none" stroke="rgba(99,102,241,0.08)" strokeWidth="11" />
              <circle cx="88" cy="88" r="54" fill="none" stroke="rgba(99,102,241,0.06)" strokeWidth="8" />
              <circle cx="88" cy="88" r="72" fill="none" stroke="#6366f1" strokeWidth="11"
                strokeDasharray={principalCircumference.toFixed(1)}
                strokeDashoffset={principalOffset.toFixed(1)}
                strokeLinecap="square" className="transition-all duration-1000" />
              <circle cx="88" cy="88" r="54" fill="none" stroke="#00e5a0" strokeWidth="8"
                strokeDasharray={yieldCircumference.toFixed(1)}
                strokeDashoffset={yieldOffset.toFixed(1)}
                strokeLinecap="square" className="transition-all duration-1000" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {total > 0 ? (
                <>
                  <div className="font-display text-[22px] font-bold text-text-primary tabular-nums">{principalPct.toFixed(1)}%</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-[3px] font-mono mt-0.5">Protected</div>
                </>
              ) : (
                <>
                  <div className="font-display text-[14px] font-semibold text-text-muted">Empty</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-[2px] font-mono mt-0.5">Deposit stETH</div>
                </>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-2.5">
            <LegendRow color="#6366f1" label="Principal (locked)" value={`${principal.toFixed(3)} stETH`} />
            <LegendRow color="#00e5a0" label="Yield (spendable)" value={`${yieldAvailable.toFixed(3)} stETH`} valueColor="#00e5a0" />
            <LegendRow color="#f59e0b" label="Yield deployed" value={`${yieldDeployed.toFixed(3)} stETH`} valueColor="#f59e0b" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value, valueColor }: { color: string; label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[12px] text-text-secondary font-body">{label}</span>
      </div>
      <span className="text-[12px] font-mono font-medium tabular-nums" style={{ color: valueColor ?? "#94a3b8" }}>{value}</span>
    </div>
  );
}
