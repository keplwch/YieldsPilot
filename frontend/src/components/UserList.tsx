import { Users, ExternalLink } from "lucide-react";
import type { RegistryUser } from "../hooks/useApi";

interface UserListProps {
  users: RegistryUser[];
  registryMode: boolean;
  registryAddress?: string;
}

export default function UserList({ users, registryMode, registryAddress }: UserListProps) {
  if (!registryMode && users.length === 0) return null;

  return (
    <div className="card-wrap">
      <div className="card-body">
        {/* Panel header — matches ActivityFeed / ReasoningPanel */}
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 flex items-center justify-center"
              style={{
                background: "rgba(99,102,241,0.10)",
                border: "1px solid rgba(99,102,241,0.22)",
              }}
            >
              <Users size={13} color="#818cf8" strokeWidth={2} />
            </div>
            <span className="font-display text-[13px] font-semibold text-text-primary tracking-wide uppercase">
              Registered Users
            </span>
            {/* Count badge */}
            <span
              className="text-[9px] font-mono font-bold px-1.5 py-0.5 tracking-widest"
              style={{
                background: "rgba(99,102,241,0.08)",
                color: "#818cf8",
                border: "1px solid rgba(99,102,241,0.22)",
              }}
            >
              {users.length}
            </span>
          </div>

          {registryAddress && (
            <a
              href={`https://sepolia.etherscan.io/address/${registryAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-mono text-accent-purple hover:text-[#a5b4fc] transition-colors"
            >
              Registry
              <ExternalLink size={9} strokeWidth={2} />
            </a>
          )}
        </div>

        {/* Body */}
        <div className="p-4">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div
                className="w-10 h-10 flex items-center justify-center"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.14)",
                  clipPath: "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)",
                }}
              >
                <Users size={16} color="rgba(99,102,241,0.4)" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <div className="text-[12px] text-text-muted font-mono">No users registered yet</div>
                <div className="text-[10px] text-text-muted/60 font-mono mt-1">
                  Deposit stETH through the Registry contract to begin
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {users.map((u, i) => (
                <UserRow key={u.user} user={u} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRow({ user: u, index }: { user: RegistryUser; index: number }) {
  const totalBalance    = parseFloat(u.state?.totalBalance    ?? "0");
  const principal       = parseFloat(u.state?.principal       ?? "0");
  const availableYield  = parseFloat(u.state?.availableYield  ?? "0");
  const yieldDeployed   = parseFloat(u.state?.yieldWithdrawn  ?? "0");
  const isPaused        = u.state?.paused ?? false;

  const statusCfg = isPaused
    ? { bg: "rgba(245,158,11,0.08)",  text: "#f59e0b", border: "rgba(245,158,11,0.22)",  label: "PAUSED" }
    : { bg: "rgba(0,229,160,0.08)",   text: "#00e5a0", border: "rgba(0,229,160,0.22)",   label: "ACTIVE" };

  return (
    <div
      className="card-wrap animate-slide-in"
      style={{ animationDelay: `${index * 80}ms`, opacity: isPaused ? 0.65 : 1 }}
    >
      <div className="card-body px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: index + addresses */}
          <div className="flex items-center gap-3">
            {/* Index badge — dual-notch like stat-wrap */}
            <div className="stat-wrap flex-shrink-0" style={{ width: 32, height: 32 }}>
              <div
                className="stat-body w-full h-full flex items-center justify-center font-mono text-[11px] font-bold text-text-primary"
              >
                {index + 1}
              </div>
            </div>

            <div className="flex flex-col gap-0.5">
              <a
                href={`https://sepolia.etherscan.io/address/${u.user}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-text-primary hover:text-accent-purple transition-colors flex items-center gap-1"
              >
                {u.user.slice(0, 6)}…{u.user.slice(-4)}
                <ExternalLink size={9} strokeWidth={2} className="opacity-40" />
              </a>
              <div className="flex items-center gap-1 text-[10px] font-mono text-text-muted">
                <span className="opacity-50">Treasury:</span>
                <a
                  href={`https://sepolia.etherscan.io/address/${u.treasury}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent-purple transition-colors"
                >
                  {u.treasury.slice(0, 6)}…{u.treasury.slice(-4)}
                </a>
              </div>
            </div>
          </div>

          {/* Right: status badge + stats */}
          <div className="flex items-center gap-4">
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              <MiniStat label="Balance"   value={totalBalance.toFixed(4)}   color="text-text-primary" />
              <MiniStat label="Principal" value={principal.toFixed(4)}      color="text-accent-purple" />
              <MiniStat label="Yield"     value={availableYield.toFixed(4)} color="text-accent-green" />
              <MiniStat label="Deployed"  value={yieldDeployed.toFixed(4)}  color="text-accent-orange" />
            </div>

            {/* Status badge — matches ActivityFeed phase badge */}
            <span
              className="text-[9px] font-mono font-bold px-2 py-0.5 tracking-widest flex-shrink-0"
              style={{
                background: statusCfg.bg,
                color: statusCfg.text,
                border: `1px solid ${statusCfg.border}`,
              }}
            >
              {statusCfg.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="text-center min-w-[56px]">
      <div className={`font-mono text-[14px] font-semibold tabular-nums leading-none ${color}`}>
        {value}
      </div>
      <div className="text-[9px] text-text-muted uppercase tracking-[2px] font-mono mt-1">
        {label}
      </div>
    </div>
  );
}
