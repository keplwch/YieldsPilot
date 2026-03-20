/**
 * YieldPilot Configuration
 * Copy .env.example to .env and fill in your keys
 */

import dotenv from "dotenv";
import type { AppConfig } from "../types/index";

dotenv.config();

const config: AppConfig = {
  // === Agent Identity (ERC-8004) ===
  agent: {
    name: "YieldPilot",
    version: "1.0.0",
    did: process.env.AGENT_DID ?? "",
    apiKey: process.env.SYNTHESIS_API_KEY ?? "",
  },

  // === Venice (Private Inference) ===
  venice: {
    baseUrl: "https://api.venice.ai/api/v1",
    apiKey: process.env.VENICE_API_KEY ?? "",
    model: "llama-3.3-70b",
    temperature: 0.3,
  },

  // === Bankr (Multi-Model LLM Gateway) ===
  bankr: {
    baseUrl: "https://llm.bankr.bot",
    apiKey: process.env.BANKR_API_KEY ?? "",
    models: {
      risk: "gpt-5-mini",
      market: "claude-haiku-4.5",
      strategy: "gemini-3-flash",
    },
  },

  // === Uniswap ===
  uniswap: {
    apiKey: process.env.UNISWAP_API_KEY ?? "",
    baseUrl: "https://trade-api.gateway.uniswap.org/v1",
    routerAddress: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  },

  // === Lido (Sepolia testnet) ===
  lido: {
    stETH: "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af",
    wstETH: "0xB82381A3fBD3FaFA77B3a7bE693342618240067b",
    withdrawalQueue: "0x1583C7b3f4C3B008720E6BcE5726336b0aB25fdd",
  },

  // === Treasury Contract ===
  treasury: {
    address: process.env.TREASURY_CONTRACT ?? "",
    maxDailySpendBps: 500, // 5% of yield per day
  },

  // === Registry Contract (Multi-User) ===
  registry: {
    address: process.env.REGISTRY_CONTRACT ?? "",
  },

  // === Blockchain ===
  chain: {
    rpcUrl: process.env.RPC_URL ?? "https://eth-sepolia.g.alchemy.com/v2/demo",
    chainId: 11155111, // Sepolia
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY ?? "",
  },

  // === Telegram Alerts ===
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },

  // === Agent Loop ===
  loop: {
    intervalMs: 60_000, // 1 minute between cycles
    maxGasPerCycleGwei: 50,
    computeBudgetUsd: 5.0, // max spend on inference per day
  },
};

export default config;
