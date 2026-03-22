/**
 * Market Data Service - Real-Time ETH Prices, Gas, and Uniswap Pool Liquidity
 *
 * Feeds live market context into Venice and Bankr reasoning prompts so the agent
 * makes informed decisions based on actual market conditions, not just on-chain
 * treasury state.
 *
 * Data sources:
 *   - CoinGecko API (ETH price, 24h change, market cap)
 *   - Etherscan Gas Tracker (current gas prices)
 *   - DeFiLlama Yields API (Uniswap V3 pool TVL + 24h volume)
 */

// ════════════════════════════════════════════════════════════════
//                        TYPES
// ════════════════════════════════════════════════════════════════

export interface MarketPriceData {
  ethPriceUsd: number;
  ethChange24h: number;
  stEthPriceUsd: number;
  stEthToEthRatio: number;
  timestamp: string;
}

export interface GasData {
  fastGwei: number;
  standardGwei: number;
  slowGwei: number;
  estimatedSwapCostUsd: number; // ~150k gas for a V3 swap
}

export interface PoolLiquidity {
  pair: string;
  feeTier: string;
  tvlUsd: number;
  volume24hUsd: number;
  token0: string;
  token1: string;
  poolAddress: string;
}

export interface MarketSnapshot {
  prices: MarketPriceData;
  gas: GasData;
  pools: PoolLiquidity[];
  fetchedAt: string;
  errors: string[]; // non-fatal errors (API timeouts etc.)
}

// ════════════════════════════════════════════════════════════════
//                    COINGECKO - ETH + stETH PRICE
// ════════════════════════════════════════════════════════════════

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

async function fetchPrices(): Promise<MarketPriceData> {
  const url = `${COINGECKO_BASE}/simple/price?ids=ethereum,staked-ether&vs_currencies=usd&include_24hr_change=true`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);

  const data = await res.json() as {
    ethereum?: { usd?: number; usd_24h_change?: number };
    "staked-ether"?: { usd?: number; usd_24h_change?: number };
  };

  const ethPrice = data.ethereum?.usd ?? 0;
  const stEthPrice = data["staked-ether"]?.usd ?? ethPrice;

  return {
    ethPriceUsd: ethPrice,
    ethChange24h: data.ethereum?.usd_24h_change ?? 0,
    stEthPriceUsd: stEthPrice,
    stEthToEthRatio: ethPrice > 0 ? stEthPrice / ethPrice : 1,
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════
//                    GAS PRICES (via RPC eth_gasPrice)
// ════════════════════════════════════════════════════════════════

async function fetchGas(rpcUrl: string, ethPriceUsd: number): Promise<GasData> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    signal: AbortSignal.timeout(5_000),
  });

  const data = await res.json() as { result?: string };
  const gasPriceWei = parseInt(data.result ?? "0x0", 16);
  const gasPriceGwei = gasPriceWei / 1e9;

  // Estimate: V3 swap ≈ 150k gas
  const swapGasUnits = 150_000;
  const swapCostEth = (gasPriceWei * swapGasUnits) / 1e18;
  const swapCostUsd = swapCostEth * ethPriceUsd;

  return {
    fastGwei: Math.round(gasPriceGwei * 1.25 * 10) / 10,
    standardGwei: Math.round(gasPriceGwei * 10) / 10,
    slowGwei: Math.round(gasPriceGwei * 0.8 * 10) / 10,
    estimatedSwapCostUsd: Math.round(swapCostUsd * 100) / 100,
  };
}

// ════════════════════════════════════════════════════════════════
//              DEFILLAMA - UNISWAP V3 POOL LIQUIDITY
// ════════════════════════════════════════════════════════════════

// DeFiLlama yields API — free, no API key required
const DEFILLAMA_POOLS_URL = "https://yields.llama.fi/pools";

// Tokens we care about for liquidity-aware sizing
const RELEVANT_TOKENS = ["WSTETH", "STETH", "WETH", "ETH"];

interface DefiLlamaPool {
  pool: string;
  symbol: string;
  tvlUsd: number;
  volumeUsd1d: number | null;
  chain: string;
  project: string;
}

async function fetchPoolLiquidity(): Promise<PoolLiquidity[]> {
  const res = await fetch(DEFILLAMA_POOLS_URL, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`DeFiLlama ${res.status}: ${res.statusText}`);

  const json = await res.json() as { data: DefiLlamaPool[] };

  // Filter to Uniswap V3 pools on Ethereum that involve stETH/wstETH/WETH
  const relevant = (json.data ?? []).filter((p) =>
    p.project === "uniswap-v3" &&
    p.chain === "Ethereum" &&
    RELEVANT_TOKENS.some((t) => (p.symbol ?? "").toUpperCase().includes(t))
  );

  // Sort by TVL descending and take top 5
  relevant.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));

  return relevant.slice(0, 5).map((p) => {
    const tokens = p.symbol.split("-");
    return {
      pair: tokens.join("/"),
      feeTier: "—",  // DeFiLlama aggregates across fee tiers
      tvlUsd: Math.round(p.tvlUsd ?? 0),
      volume24hUsd: Math.round(p.volumeUsd1d ?? 0),
      token0: tokens[0] ?? "",
      token1: tokens[1] ?? "",
      poolAddress: p.pool, // DeFiLlama UUID, not on-chain address
    };
  });
}

// ════════════════════════════════════════════════════════════════
//                    PUBLIC API
// ════════════════════════════════════════════════════════════════

// Cache: avoid hammering APIs every 60s cycle
let cachedSnapshot: MarketSnapshot | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 120_000; // 2 minutes

/**
 * Fetch a full market snapshot (prices + gas + pool liquidity).
 * Results are cached for 2 minutes to respect API rate limits.
 */
export async function getMarketSnapshot(rpcUrl: string): Promise<MarketSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const errors: string[] = [];

  // Fetch all data concurrently - each source is independent
  let prices: MarketPriceData = {
    ethPriceUsd: 0,
    ethChange24h: 0,
    stEthPriceUsd: 0,
    stEthToEthRatio: 1,
    timestamp: new Date().toISOString(),
  };

  let gas: GasData = {
    fastGwei: 0,
    standardGwei: 0,
    slowGwei: 0,
    estimatedSwapCostUsd: 0,
  };

  let pools: PoolLiquidity[] = [];

  const [priceResult, gasResult, poolResult] = await Promise.allSettled([
    fetchPrices(),
    fetchGas(rpcUrl, 0), // placeholder - we'll recalculate after prices
    fetchPoolLiquidity(),
  ]);

  if (priceResult.status === "fulfilled") {
    prices = priceResult.value;
  } else {
    errors.push(`Price fetch failed: ${priceResult.reason}`);
  }

  // Re-fetch gas with actual ETH price for USD estimate
  if (prices.ethPriceUsd > 0) {
    try {
      gas = await fetchGas(rpcUrl, prices.ethPriceUsd);
    } catch (e) {
      if (gasResult.status === "fulfilled") {
        gas = gasResult.value;
      } else {
        errors.push(`Gas fetch failed: ${(e as Error).message}`);
      }
    }
  } else if (gasResult.status === "fulfilled") {
    gas = gasResult.value;
  } else {
    errors.push(`Gas fetch failed: ${gasResult.reason}`);
  }

  if (poolResult.status === "fulfilled") {
    pools = poolResult.value;
  } else {
    errors.push(`Pool liquidity fetch failed: ${poolResult.reason}`);
  }

  const snapshot: MarketSnapshot = {
    prices,
    gas,
    pools,
    fetchedAt: new Date().toISOString(),
    errors,
  };

  cachedSnapshot = snapshot;
  lastFetchTime = now;

  return snapshot;
}

/**
 * Format market snapshot into a concise string for LLM prompts.
 * Designed to give the agent maximum context in minimum tokens.
 */
export function formatForPrompt(snapshot: MarketSnapshot): string {
  const { prices, gas, pools } = snapshot;

  const lines: string[] = [
    "═══ LIVE MARKET DATA ═══",
    "",
    `ETH Price: $${prices.ethPriceUsd.toLocaleString()} (${prices.ethChange24h >= 0 ? "+" : ""}${prices.ethChange24h.toFixed(2)}% 24h)`,
    `stETH Price: $${prices.stEthPriceUsd.toLocaleString()} (ratio to ETH: ${prices.stEthToEthRatio.toFixed(6)})`,
    `stETH ${prices.stEthToEthRatio >= 0.999 ? "at peg ✓" : prices.stEthToEthRatio >= 0.995 ? "slight discount" : "⚠ DEPEG WARNING: " + ((1 - prices.stEthToEthRatio) * 100).toFixed(2) + "% below ETH"}`,
    "",
    `Gas: ${gas.standardGwei} gwei (swap cost ≈ $${gas.estimatedSwapCostUsd})`,
  ];

  if (pools.length > 0) {
    lines.push("");
    lines.push("═══ UNISWAP V3 POOL LIQUIDITY (top pools) ═══");
    lines.push("Pool                  | Fee Tier | TVL            | 24h Volume");
    lines.push("─────────────────────-+──────────+────────────────+──────────────");

    for (const pool of pools) {
      const pair = pool.pair.padEnd(22);
      const fee = pool.feeTier.padEnd(9);
      const tvl = `$${formatCompact(pool.tvlUsd)}`.padEnd(15);
      const vol = `$${formatCompact(pool.volume24hUsd)}`;
      lines.push(`${pair}| ${fee}| ${tvl}| ${vol}`);
    }
  }

  if (snapshot.errors.length > 0) {
    lines.push("");
    lines.push(`[Data warnings: ${snapshot.errors.join("; ")}]`);
  }

  return lines.join("\n");
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/**
 * Build liquidity-aware swap guidance for the LLM.
 * Tells the agent when a swap is too large relative to pool TVL.
 */
export function getLiquidityGuidance(
  swapAmountStEth: number,
  ethPriceUsd: number,
  pools: PoolLiquidity[]
): string {
  if (pools.length === 0) return "Pool liquidity data unavailable - proceed with caution.";

  const swapValueUsd = swapAmountStEth * ethPriceUsd;

  const lines: string[] = ["═══ LIQUIDITY-AWARE SWAP GUIDANCE ═══"];

  for (const pool of pools) {
    const ratioToTvl = pool.tvlUsd > 0 ? swapValueUsd / pool.tvlUsd : Infinity;
    const ratioToVolume = pool.volume24hUsd > 0 ? swapValueUsd / pool.volume24hUsd : Infinity;
    const pctOfTvl = (ratioToTvl * 100).toFixed(3);
    const pctOfVol = (ratioToVolume * 100).toFixed(3);

    let verdict = "✓ Swap size is negligible - no slippage concern";
    if (ratioToTvl > 0.01) verdict = "⚠ Swap is >1% of pool TVL - consider splitting across 2-3 cycles";
    if (ratioToTvl > 0.05) verdict = "🛑 Swap is >5% of pool TVL - STRONGLY recommend splitting across 5+ cycles to avoid price impact";
    if (ratioToTvl > 0.10) verdict = "🚫 Swap is >10% of pool TVL - DO NOT execute in a single transaction. Split into at least 10 cycles.";

    lines.push(`  ${pool.pair} (${pool.feeTier}): swap is ${pctOfTvl}% of TVL, ${pctOfVol}% of 24h volume → ${verdict}`);
  }

  return lines.join("\n");
}
