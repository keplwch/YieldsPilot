import { Coins } from "lucide-react";
import { NETWORK } from "@/config/network";

interface TokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
}

interface TokenPortfolioProps {
  tokens: TokenBalance[];
  ethBalance: string;
  treasuryAddress: string;
}

// Token colors for the bar chart
const TOKEN_COLORS: Record<string, string> = {
  stETH: "#6366f1",
  USDC: "#2775ca",
  WETH: "#627eea",
  ETH: "#627eea",
  DAI: "#f5ac37",
};

function getTokenColor(symbol: string): string {
  return TOKEN_COLORS[symbol] ?? "#00e5a0";
}

export default function TokenPortfolio({ tokens, ethBalance, treasuryAddress }: TokenPortfolioProps) {
  // Filter out zero balances
  const nonZero = tokens.filter(t => parseFloat(t.balance) > 0);
  const hasEth = parseFloat(ethBalance) > 0;

  // For the bar chart, compute totals (just visual proportions, not USD value)
  const totalValue = nonZero.reduce((sum, t) => {
    // Rough USD estimates for visual sizing
    if (t.symbol === "stETH" || t.symbol === "WETH") return sum + parseFloat(t.balance) * 2000;
    if (t.symbol === "USDC" || t.symbol === "DAI") return sum + parseFloat(t.balance);
    return sum + parseFloat(t.balance);
  }, hasEth ? parseFloat(ethBalance) * 2000 : 0);

  return (
    <div className="card-wrap">
      <div className="card-body">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(39,117,202,0.1)", border: "1px solid rgba(39,117,202,0.2)" }}>
              <Coins size={12} style={{ color: "#2775ca" }} strokeWidth={2} />
            </div>
            <span className="text-[13px] font-display font-semibold text-text-primary">Treasury Portfolio</span>
          </div>
          <a
            href={`${NETWORK.explorerBase}/address/${treasuryAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-text-muted hover:text-accent-purple transition-colors"
          >
            {treasuryAddress.slice(0, 6)}...{treasuryAddress.slice(-4)} ↗
          </a>
        </div>

        <div className="p-6">
          {nonZero.length === 0 && !hasEth ? (
            <div className="text-center py-6">
              <div className="text-[11px] font-mono text-text-muted">No token balances detected</div>
            </div>
          ) : (
            <>
              {/* Horizontal stacked bar */}
              {totalValue > 0 && (
                <div className="flex h-3 rounded-sm overflow-hidden mb-5 gap-px">
                  {nonZero.map((t) => {
                    const val = (t.symbol === "stETH" || t.symbol === "WETH")
                      ? parseFloat(t.balance) * 2000
                      : parseFloat(t.balance);
                    const pct = (val / totalValue) * 100;
                    if (pct < 0.5) return null;
                    return (
                      <div
                        key={t.address}
                        className="h-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: getTokenColor(t.symbol),
                          minWidth: "4px",
                        }}
                        title={`${t.symbol}: ${parseFloat(t.balance).toFixed(8)}`}
                      />
                    );
                  })}
                </div>
              )}

              {/* Token list */}
              <div className="flex flex-col gap-3">
                {nonZero.map((t) => (
                  <div key={t.address} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-2.5 h-2.5 flex-shrink-0 rounded-sm"
                        style={{ backgroundColor: getTokenColor(t.symbol) }}
                      />
                      <span className="text-[12px] font-display font-medium text-text-primary">{t.symbol}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-mono font-semibold text-text-primary tabular-nums">
                        {parseFloat(t.balance) < 0.0001
                          ? parseFloat(t.balance).toExponential(2)
                          : parseFloat(t.balance).toFixed(8)}
                      </span>
                      {t.symbol === "USDC" && parseFloat(t.balance) > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5"
                          style={{ background: "rgba(39,117,202,0.08)", color: "#2775ca", border: "1px solid rgba(39,117,202,0.18)" }}>
                          SWAP OUTPUT
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {hasEth && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: "#627eea" }} />
                      <span className="text-[12px] font-display font-medium text-text-secondary">ETH (gas)</span>
                    </div>
                    <span className="text-[13px] font-mono text-text-muted tabular-nums">
                      {parseFloat(ethBalance).toFixed(8)}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
