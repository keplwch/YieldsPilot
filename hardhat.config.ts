import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();

// ╔══════════════════════════════════════════════════════════════╗
// ║  YieldsPilot — Hardhat Configuration                        ║
// ║                                                             ║
// ║  CHAINS:                                                    ║
// ║    • Ethereum Sepolia  → Treasury + Lido + Uniswap          ║
// ║    • Ethereum Mainnet  → Production (when ready)            ║
// ║    • Status Sepolia    → Bonus gasless bounty ($2,000)      ║
// ║                                                             ║
// ║  NOTE: ERC-8004 identity lives on Base Mainnet              ║
// ║        (handled by synthesis.devfolio.co API, not Hardhat)  ║
// ╚══════════════════════════════════════════════════════════════╝

const DEPLOYER_KEY = process.env.AGENT_PRIVATE_KEY || "0x" + "0".repeat(64);
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    // ── Local ────────────────────────────────────────────
    hardhat: {
      // Fork mainnet only if FORK_RPC is explicitly set (for local fork testing)
      // Otherwise use plain Hardhat network (for unit tests with mocks)
      ...(process.env.FORK_RPC
        ? {
            forking: {
              url: process.env.FORK_RPC,
              // No pinned block — forks at latest for up-to-date pool state
            },
          }
        : {}),
    },

    // ── Ethereum Sepolia (PRIMARY — Lido + Uniswap bounties) ──
    sepolia: {
      url: process.env.RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo",
      chainId: 11155111,
      accounts: [DEPLOYER_KEY],
      gasPrice: "auto",
    },

    // ── Ethereum Mainnet (production) ────────────────────
    // Uses the same RPC_URL as Sepolia — just point it at a mainnet
    // endpoint when deploying to mainnet (e.g. Alchemy mainnet URL)
    mainnet: {
      url: process.env.RPC_URL || "",
      chainId: 1,
      accounts: [DEPLOYER_KEY],
      // Slightly higher gas for faster inclusion on mainnet
      gasMultiplier: 1.2,
    },

    // ── Status Network Sepolia (bonus $2,000 bounty) ─────
    // Requires: deploy contract + 1 gasless tx + tx hash proof
    statusSepolia: {
      url: "https://public.sepolia.status.im",
      chainId: 2020,
      accounts: [DEPLOYER_KEY],
      gasPrice: 0, // gasless!
    },
  },

  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_KEY,
      mainnet: ETHERSCAN_KEY,
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
