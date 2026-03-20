import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Activity, Cpu } from "lucide-react";

interface HeaderProps {
  cycleCount: number;
  connected?: boolean;
  running?: boolean;
}

export default function Header({ cycleCount, connected, running }: HeaderProps) {
  const statusBg = running
    ? "bg-accent-green/8 border-accent-green/25 text-accent-green"
    : connected
      ? "bg-accent-orange/8 border-accent-orange/25 text-accent-orange"
      : "bg-text-muted/8 border-text-muted/20 text-text-muted";

  const statusDot = running ? "bg-accent-green animate-pulse-glow" : connected ? "bg-accent-orange" : "bg-text-muted";

  const statusText = running
    ? `Active — Cycle #${cycleCount}`
    : connected
      ? `Idle — ${cycleCount} cycles`
      : "Offline";

  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle backdrop-blur-xl bg-bg-primary/92">
      <div className="max-w-[1360px] mx-auto px-8 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.3)",
              clipPath: "polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)",
            }}>
            <Cpu size={16} className="text-accent-purple" strokeWidth={1.5} />
            {running && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-green border-2 border-bg-primary animate-pulse-glow" />
            )}
          </div>
          <div>
            <div className="font-display text-[20px] font-bold text-text-primary leading-none tracking-tight">YieldPilot</div>
            <div className="text-[9px] text-text-muted font-mono tracking-[3px] uppercase mt-0.5">Autonomous DeFi Agent</div>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Network badge */}
          {connected && (
            <div className="px-2.5 py-1 text-[10px] font-mono text-text-muted tracking-widest uppercase"
              style={{ border: "1px solid rgba(99,102,241,0.15)", background: "transparent" }}>
              Sepolia
            </div>
          )}

          {/* Agent status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border ${statusBg}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            <Activity size={10} strokeWidth={2} />
            {statusText}
          </div>

          {/* Connect Button */}
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
              const ready = mounted;
              const isConnected = ready && account && chain;
              return (
                <div {...(!ready && { "aria-hidden": true, style: { opacity: 0, pointerEvents: "none" as const, userSelect: "none" as const } })}>
                  {(() => {
                    if (!isConnected) {
                      return (
                        <button
                          onClick={openConnectModal}
                          className="px-4 py-2 font-display font-semibold text-[12px] text-white bg-accent-purple hover:bg-accent-purple/90 transition-colors cursor-pointer"
                          style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}
                        >
                          Connect Wallet
                        </button>
                      );
                    }
                    if (chain.unsupported) {
                      return (
                        <button onClick={openChainModal}
                          className="px-4 py-2 font-display font-semibold text-[12px] text-accent-red bg-accent-red/10 border border-accent-red/30 hover:bg-accent-red/20 transition-colors cursor-pointer">
                          Wrong Network
                        </button>
                      );
                    }
                    return (
                      <button onClick={openAccountModal}
                        className="px-4 py-2 font-mono font-medium text-[11px] bg-bg-card border border-border-subtle text-text-secondary hover:border-accent-purple/40 hover:text-text-primary transition-all flex items-center gap-2 cursor-pointer">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                        {account.displayName}
                      </button>
                    );
                  })()}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
