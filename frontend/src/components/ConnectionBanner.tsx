import { Zap } from "lucide-react";

interface ConnectionBannerProps {
  connected: boolean;
  network?: string;
}

export default function ConnectionBanner({ connected, network }: ConnectionBannerProps) {
  if (connected) return null;

  return (
    <div className="max-w-[1360px] mx-auto px-8 pt-5">
      {/* Outer border layer */}
      <div style={{
        clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
        background: "rgba(245,158,11,0.22)",
        padding: "1px",
      }}>
        {/* Inner content */}
        <div className="flex items-center gap-3 px-5 py-3 text-[12px]"
          style={{
            clipPath: "polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%)",
            background: "rgba(245,158,11,0.05)",
          }}>
          <Zap size={12} strokeWidth={2} style={{ color: "#f59e0b", flexShrink: 0 }} />
          <div className="font-body">
            <span className="font-semibold text-amber-300">Demo Mode</span>
            <span className="text-amber-400/70"> - API not connected. Run </span>
            <code className="px-1.5 py-0.5 text-[11px] font-mono"
              style={{ background: "rgba(0,0,0,0.3)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.18)" }}>
              ./scripts/dev.sh start
            </code>
            <span className="text-amber-400/70"> for live data.</span>
            {network && <span className="ml-2 text-amber-400/40 font-mono text-[10px]">net:{network}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
