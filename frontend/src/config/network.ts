/**
 * Network-aware contract addresses and explorer URLs.
 *
 * The active network is selected via the VITE_NETWORK env var:
 *   VITE_NETWORK=mainnet  → Ethereum Mainnet (chainId 1)
 *   VITE_NETWORK=sepolia  → Ethereum Sepolia  (chainId 11155111)  [default]
 *
 * Usage:
 *   import { NETWORK } from "@/config/network";
 *   NETWORK.stETH        // stETH contract address for the active network
 *   NETWORK.explorerTx(hash)  // full Etherscan tx URL
 */

// ── Per-network constants ────────────────────────────────────────────────────

interface NetworkConfig {
  name: string;
  chainId: number;
  stETH: `0x${string}`;
  wstETH: `0x${string}`;
  uniswapRouter: `0x${string}`;
  explorerBase: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
}

const SEPOLIA: NetworkConfig = {
  name: "sepolia",
  chainId: 11155111,
  stETH: "0xB43d41AB3aD0f006b8A4d872FBA11f4858E23a87",
  wstETH: "0x6F3bf3371aBe2A27C89B0FFE38E8057CD4089C83",
  uniswapRouter: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  explorerBase: "https://sepolia.etherscan.io",
  explorerTx: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
  explorerAddress: (addr) => `https://sepolia.etherscan.io/address/${addr}`,
};

const MAINNET: NetworkConfig = {
  name: "mainnet",
  chainId: 1,
  stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  uniswapRouter: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  explorerBase: "https://etherscan.io",
  explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
  explorerAddress: (addr) => `https://etherscan.io/address/${addr}`,
};

// ── Active network selection ─────────────────────────────────────────────────

const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: SEPOLIA,
  mainnet: MAINNET,
};

const activeNetwork = import.meta.env.VITE_NETWORK || "sepolia";

export const NETWORK: NetworkConfig = NETWORKS[activeNetwork] ?? SEPOLIA;

export const IS_MAINNET = NETWORK.chainId === 1;

export { SEPOLIA, MAINNET, type NetworkConfig };
