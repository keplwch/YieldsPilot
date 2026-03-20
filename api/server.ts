/**
 * YieldPilot API Server (Multi-User)
 *
 * Serves real on-chain data from Ethereum Sepolia and agent logs
 * to the React dashboard. Supports both single-treasury and
 * registry (multi-user) modes.
 *
 * Endpoints:
 *   GET /api/treasury          — Single treasury state (backward compat)
 *   GET /api/treasury/:address — Specific treasury state by address
 *   GET /api/registry          — Registry info + all user treasuries
 *   GET /api/users             — All registered users with their treasury data
 *   GET /api/balances          — Agent wallet balances
 *   GET /api/protocol          — Lido protocol stats
 *   GET /api/logs              — Agent cycle logs
 *   GET /api/status            — Agent runtime status
 *   GET /api/yield-history     — Yield over time for chart
 *   GET /api/health            — Health check
 */

import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

// ── Chain Connection ─────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const TREASURY_ADDRESS = process.env.TREASURY_CONTRACT || "";
const REGISTRY_ADDRESS = process.env.REGISTRY_CONTRACT || "";
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || "";

// Derive agent address from private key
let agentAddress = "";
try {
  if (AGENT_PRIVATE_KEY && AGENT_PRIVATE_KEY !== "0x" + "0".repeat(64)) {
    const wallet = new ethers.Wallet(AGENT_PRIVATE_KEY);
    agentAddress = wallet.address;
  }
} catch {
  console.warn("⚠ Could not derive agent address from AGENT_PRIVATE_KEY");
}

// ── Contract ABIs ────────────────────────────────────────────────
const TREASURY_ABI = [
  "function principal() view returns (uint256)",
  "function availableYield() view returns (uint256)",
  "function totalBalance() view returns (uint256)",
  "function yieldWithdrawn() view returns (uint256)",
  "function maxDailySpendBps() view returns (uint256)",
  "function dailySpendRemaining() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function stETH() view returns (address)",
  "function dailySpent() view returns (uint256)",
  "function windowStart() view returns (uint256)",
];

const REGISTRY_ABI = [
  "function treasuryCount() view returns (uint256)",
  "function getAllTreasuries() view returns (address[])",
  "function getAllUsers() view returns (address[])",
  "function getUserTreasuryPairs(uint256 offset, uint256 limit) view returns (address[] users, address[] treasuries)",
  "function userTreasury(address) view returns (address)",
  "function agent() view returns (address)",
  "function admin() view returns (address)",
  "function defaultMaxDailyBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function stETH() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// Lido stETH/wstETH addresses on Sepolia
const STETH_ADDRESS = process.env.STETH_ADDRESS || "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af";
const WSTETH_ADDRESS = "0xB82381A3fBD3FaFA77B3a7bE693342618240067b";

// ── Cache ────────────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Record<string, CacheEntry<unknown>> = {};
const CACHE_TTL = 15_000;

function getCached<T>(key: string): T | null {
  const entry = cache[key] as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, timestamp: Date.now() };
}

// ── Agent state files ────────────────────────────────────────────
const AGENT_STATE_PATH = path.resolve(process.cwd(), "agent_state.json");
const AGENT_LOG_PATH = path.resolve(process.cwd(), "agent_log.json");

function readAgentState(): Record<string, unknown> {
  try {
    if (fs.existsSync(AGENT_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(AGENT_STATE_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {
    running: false,
    cycleCount: 0,
    lastAction: null,
    computeSpentUsd: 0,
    startedAt: null,
    usersProcessed: 0,
    treasuriesManaged: [],
  };
}

function readAgentLogs(): Record<string, unknown> {
  try {
    if (fs.existsSync(AGENT_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(AGENT_LOG_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { agent: "YieldPilot", version: "1.0.0", cycles: [] };
}

// ── Helper: read a single treasury's state ───────────────────────
async function readTreasuryState(treasuryAddr: string) {
  const treasury = new ethers.Contract(treasuryAddr, TREASURY_ABI, provider);

  const [
    principal,
    availableYield,
    totalBalance,
    yieldWithdrawn,
    maxDailySpendBps,
    dailySpendRemaining,
    paused,
    owner,
    agent,
  ] = await Promise.all([
    treasury.principal(),
    treasury.availableYield(),
    treasury.totalBalance(),
    treasury.yieldWithdrawn(),
    treasury.maxDailySpendBps(),
    treasury.dailySpendRemaining(),
    treasury.paused(),
    treasury.owner(),
    treasury.agent(),
  ]);

  return {
    address: treasuryAddr,
    principal: ethers.formatEther(principal),
    availableYield: ethers.formatEther(availableYield),
    totalBalance: ethers.formatEther(totalBalance),
    yieldWithdrawn: ethers.formatEther(yieldWithdrawn),
    maxDailySpendBps: maxDailySpendBps.toString(),
    dailySpendRemaining: ethers.formatEther(dailySpendRemaining),
    paused,
    owner,
    agent,
  };
}

// ══════════════════════════════════════════════════════════════════
//                        API ROUTES
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/treasury
 * Returns single treasury state (backward compatible).
 * If REGISTRY is configured but no TREASURY, returns aggregate of first user.
 */
app.get("/api/treasury", async (_req, res) => {
  try {
    const cached = getCached<Record<string, unknown>>("treasury");
    if (cached) return res.json(cached);

    // If registry mode, get first treasury as default
    let treasuryAddr = TREASURY_ADDRESS;

    if (!treasuryAddr && REGISTRY_ADDRESS) {
      try {
        const reg = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        const count: bigint = await reg.treasuryCount();
        if (count > 0n) {
          const treasuries: string[] = await reg.getAllTreasuries();
          treasuryAddr = treasuries[0];
        }
      } catch { /* ignore */ }
    }

    if (!treasuryAddr) {
      return res.json({
        connected: false,
        error: "No treasury configured",
        principal: "0",
        availableYield: "0",
        totalBalance: "0",
        yieldWithdrawn: "0",
        maxDailySpendBps: "0",
        dailySpendRemaining: "0",
        paused: false,
        registryMode: !!REGISTRY_ADDRESS,
        registryAddress: REGISTRY_ADDRESS || null,
      });
    }

    const treasuryState = await readTreasuryState(treasuryAddr);

    const result = {
      connected: true,
      ...treasuryState,
      chainId: 11155111,
      network: "sepolia",
      registryMode: !!REGISTRY_ADDRESS,
      registryAddress: REGISTRY_ADDRESS || null,
      updatedAt: new Date().toISOString(),
    };

    setCache("treasury", result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Treasury read error:", message);
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/treasury/:address
 * Returns state of a specific treasury by address
 */
app.get("/api/treasury/:address", async (req, res) => {
  try {
    const addr = req.params.address;
    if (!ethers.isAddress(addr)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    const cacheKey = `treasury_${addr}`;
    const cached = getCached<Record<string, unknown>>(cacheKey);
    if (cached) return res.json(cached);

    const treasuryState = await readTreasuryState(addr);

    const result = {
      connected: true,
      ...treasuryState,
      chainId: 11155111,
      network: "sepolia",
      updatedAt: new Date().toISOString(),
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/registry
 * Returns registry state with all registered user treasuries
 */
app.get("/api/registry", async (_req, res) => {
  try {
    const cached = getCached<Record<string, unknown>>("registry");
    if (cached) return res.json(cached);

    if (!REGISTRY_ADDRESS) {
      return res.json({
        connected: false,
        registryMode: false,
        error: "REGISTRY_CONTRACT not configured",
        users: [],
        treasuryCount: TREASURY_ADDRESS ? 1 : 0,
        // If single treasury mode, return it as a single user
        singleTreasury: TREASURY_ADDRESS || null,
      });
    }

    const reg = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

    const [count, admin, regAgent, defaultBps, regPaused] = await Promise.all([
      reg.treasuryCount() as Promise<bigint>,
      reg.admin() as Promise<string>,
      reg.agent() as Promise<string>,
      reg.defaultMaxDailyBps() as Promise<bigint>,
      reg.paused() as Promise<boolean>,
    ]);

    let users: Array<{ user: string; treasury: string; state?: Record<string, unknown> }> = [];

    if (count > 0n) {
      const [userAddrs, treasuryAddrs]: [string[], string[]] =
        await reg.getUserTreasuryPairs(0, count);

      // Fetch state for each treasury (in parallel, batched)
      const states = await Promise.allSettled(
        treasuryAddrs.map((addr: string) => readTreasuryState(addr))
      );

      users = userAddrs.map((user: string, i: number) => ({
        user,
        treasury: treasuryAddrs[i],
        state: states[i].status === "fulfilled" ? states[i].value : undefined,
      }));
    }

    const result = {
      connected: true,
      registryMode: true,
      registryAddress: REGISTRY_ADDRESS,
      admin,
      agent: regAgent,
      defaultMaxDailyBps: defaultBps.toString(),
      paused: regPaused,
      treasuryCount: Number(count),
      users,
      chainId: 11155111,
      network: "sepolia",
      updatedAt: new Date().toISOString(),
    };

    setCache("registry", result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Registry read error:", message);
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/users
 * Returns all registered users with their treasury data
 */
app.get("/api/users", async (_req, res) => {
  try {
    const cached = getCached<Record<string, unknown>>("users");
    if (cached) return res.json(cached);

    if (!REGISTRY_ADDRESS) {
      // Single-user fallback
      if (TREASURY_ADDRESS) {
        try {
          const state = await readTreasuryState(TREASURY_ADDRESS);
          return res.json({
            connected: true,
            registryMode: false,
            users: [{ user: state.owner, treasury: TREASURY_ADDRESS, state }],
            updatedAt: new Date().toISOString(),
          });
        } catch { /* fall through */ }
      }
      return res.json({ connected: false, users: [], registryMode: false });
    }

    const reg = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    const count: bigint = await reg.treasuryCount();

    if (count === 0n) {
      return res.json({
        connected: true,
        registryMode: true,
        users: [],
        treasuryCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    const [userAddrs, treasuryAddrs]: [string[], string[]] =
      await reg.getUserTreasuryPairs(0, count);

    const states = await Promise.allSettled(
      treasuryAddrs.map((addr: string) => readTreasuryState(addr))
    );

    const users = userAddrs.map((user: string, i: number) => ({
      user,
      treasury: treasuryAddrs[i],
      state: states[i].status === "fulfilled" ? states[i].value : null,
    }));

    const result = {
      connected: true,
      registryMode: true,
      users,
      treasuryCount: Number(count),
      registryAddress: REGISTRY_ADDRESS,
      updatedAt: new Date().toISOString(),
    };

    setCache("users", result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/user/:address
 * Returns treasury info for a specific user address
 */
app.get("/api/user/:address", async (req, res) => {
  try {
    const userAddr = req.params.address;
    if (!ethers.isAddress(userAddr)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    if (!REGISTRY_ADDRESS) {
      return res.json({ connected: false, error: "No registry configured" });
    }

    const reg = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    const treasuryAddr: string = await reg.userTreasury(userAddr);

    if (treasuryAddr === ethers.ZeroAddress) {
      return res.json({
        connected: true,
        user: userAddr,
        hasTreasury: false,
        registryAddress: REGISTRY_ADDRESS,
      });
    }

    const state = await readTreasuryState(treasuryAddr);

    res.json({
      connected: true,
      user: userAddr,
      hasTreasury: true,
      treasury: treasuryAddr,
      state,
      registryAddress: REGISTRY_ADDRESS,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/balances
 */
app.get("/api/balances", async (_req, res) => {
  try {
    const cached = getCached<Record<string, unknown>>("balances");
    if (cached) return res.json(cached);

    if (!agentAddress) {
      return res.json({
        connected: false,
        error: "AGENT_PRIVATE_KEY not configured",
        address: "",
        eth: "0",
        stETH: "0",
        wstETH: "0",
      });
    }

    const stETH = new ethers.Contract(STETH_ADDRESS, ERC20_ABI, provider);
    const wstETH = new ethers.Contract(WSTETH_ADDRESS, ERC20_ABI, provider);

    const [ethBal, stETHBal, wstETHBal] = await Promise.all([
      provider.getBalance(agentAddress),
      stETH.balanceOf(agentAddress).catch(() => 0n),
      wstETH.balanceOf(agentAddress).catch(() => 0n),
    ]);

    const result = {
      connected: true,
      address: agentAddress,
      eth: ethers.formatEther(ethBal),
      stETH: ethers.formatEther(stETHBal),
      wstETH: ethers.formatEther(wstETHBal),
      network: "sepolia",
      updatedAt: new Date().toISOString(),
    };

    setCache("balances", result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Balances read error:", message);
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/protocol
 */
app.get("/api/protocol", async (_req, res) => {
  try {
    const cached = getCached<Record<string, unknown>>("protocol");
    if (cached) return res.json(cached);

    const stETH = new ethers.Contract(STETH_ADDRESS, [
      "function totalSupply() view returns (uint256)",
      "function getTotalPooledEther() view returns (uint256)",
      "function getTotalShares() view returns (uint256)",
    ], provider);

    const wstETH = new ethers.Contract(WSTETH_ADDRESS, [
      "function stEthPerToken() view returns (uint256)",
    ], provider);

    let totalPooledEther = "0";
    let totalShares = "0";
    let stEthPerWstEth = "1.0";

    try {
      const [pooled, shares] = await Promise.all([
        stETH.getTotalPooledEther(),
        stETH.getTotalShares(),
      ]);
      totalPooledEther = ethers.formatEther(pooled);
      totalShares = ethers.formatEther(shares);
    } catch {
      try {
        const supply = await stETH.totalSupply();
        totalPooledEther = ethers.formatEther(supply);
      } catch { /* ignore */ }
    }

    try {
      const ratio = await wstETH.stEthPerToken();
      stEthPerWstEth = parseFloat(ethers.formatEther(ratio)).toFixed(6);
    } catch { /* ignore */ }

    const result = {
      totalPooledEther,
      totalShares,
      stEthPerWstEth,
      exchangeRate: stEthPerWstEth,
      aprEstimate: "3.4",
      network: "sepolia",
      updatedAt: new Date().toISOString(),
    };

    setCache("protocol", result);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/logs?limit=50
 */
app.get("/api/logs", (_req, res) => {
  try {
    const limit = parseInt((_req.query.limit as string) ?? "50", 10);
    const agentLog = readAgentLogs() as { cycles?: unknown[] };
    const cycles = agentLog.cycles ?? [];

    const recent = cycles.slice(-limit);

    res.json({
      agent: "YieldPilot",
      totalCycles: cycles.length,
      cycles: recent,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/status
 */
app.get("/api/status", (_req, res) => {
  try {
    const agentState = readAgentState();
    const agentLog = readAgentLogs() as { cycles?: unknown[] };
    const cycles = agentLog.cycles ?? [];

    const startedAt = agentState.startedAt as string | null;
    let uptimeMs = 0;
    if (startedAt) {
      uptimeMs = Date.now() - new Date(startedAt).getTime();
    }

    const lastCycle = cycles.length > 0 ? cycles[cycles.length - 1] : null;

    res.json({
      running: agentState.running ?? false,
      cycleCount: agentState.cycleCount ?? cycles.length,
      lastAction: agentState.lastAction ?? null,
      computeSpentUsd: agentState.computeSpentUsd ?? 0,
      startedAt,
      uptimeMs,
      lastCycle,
      // Multi-user info
      usersProcessed: agentState.usersProcessed ?? 0,
      treasuriesManaged: agentState.treasuriesManaged ?? [],
      registryMode: !!REGISTRY_ADDRESS,
      registryAddress: REGISTRY_ADDRESS || null,
      treasuryConnected: !!TREASURY_ADDRESS || !!REGISTRY_ADDRESS,
      agentAddress,
      network: "sepolia",
      chainId: 11155111,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/yield-history
 */
app.get("/api/yield-history", (_req, res) => {
  try {
    const agentLog = readAgentLogs() as { cycles?: Array<Record<string, unknown>> };
    const cycles = agentLog.cycles ?? [];

    const yieldHistory: Array<{ date: string; yield: number; balance: number }> = [];

    for (const entry of cycles) {
      const discover = (entry as Record<string, unknown>).discover as Record<string, unknown> | undefined;
      const outputs = discover
        ? (discover.outputs as Record<string, unknown>)
        : entry.phase === "discover"
          ? (entry.outputs as Record<string, unknown>)
          : null;

      if (outputs) {
        const balances = outputs.balances as Record<string, unknown> | undefined;
        const treasury = balances?.treasury as Record<string, unknown> | undefined;

        if (treasury) {
          yieldHistory.push({
            date: (discover?.timestamp ?? entry.timestamp ?? new Date().toISOString()) as string,
            yield: parseFloat((treasury.availableYield as string) ?? "0"),
            balance: parseFloat((treasury.totalBalance as string) ?? "0"),
          });
        }
      }
    }

    res.json({
      history: yieldHistory.slice(-30),
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message, history: [] });
  }
});

/**
 * GET /api/health
 */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    rpc: RPC_URL.replace(/\/[^/]*$/, "/***"),
    treasury: TREASURY_ADDRESS || "not configured",
    registry: REGISTRY_ADDRESS || "not configured",
    agent: agentAddress || "not configured",
    mode: REGISTRY_ADDRESS ? "multi-user (registry)" : TREASURY_ADDRESS ? "single-user" : "unconfigured",
  });
});

// ── Start Server ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 YieldPilot API running on http://localhost:${PORT}`);
  console.log(`   Mode:     ${REGISTRY_ADDRESS ? "Multi-User (Registry)" : "Single-User"}`);
  console.log(`   RPC:      ${RPC_URL.substring(0, 50)}...`);
  console.log(`   Treasury: ${TREASURY_ADDRESS || "via registry"}`);
  console.log(`   Registry: ${REGISTRY_ADDRESS || "not configured"}`);
  console.log(`   Agent:    ${agentAddress || "not configured"}`);
  console.log(`   Endpoints:`);
  console.log(`     GET /api/health`);
  console.log(`     GET /api/treasury`);
  console.log(`     GET /api/treasury/:address`);
  console.log(`     GET /api/registry`);
  console.log(`     GET /api/users`);
  console.log(`     GET /api/user/:address`);
  console.log(`     GET /api/balances`);
  console.log(`     GET /api/protocol`);
  console.log(`     GET /api/logs`);
  console.log(`     GET /api/status`);
  console.log(`     GET /api/yield-history\n`);
});

export default app;
