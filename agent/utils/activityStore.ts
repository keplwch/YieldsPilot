/**
 * Activity Store — SQLite persistence for agent activity.
 * Uses sql.js (pure JS/WASM) for cross-platform compatibility (no native addons).
 *
 * Note: agent_log.json and agent_state.json are kept separately
 * for the Protocol Labs "Let the Agent Cook" bounty (ERC-8004 compliance).
 * This DB is purely for the dashboard UX.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), "yieldpilot.db");

// ── Types ──────────────────────────────────────────────────────────

export interface ActivityRecord {
  id: string;
  cycle: number;
  timestamp: string;
  user: string;
  treasuryAddress: string;
  action: "swap_yield" | "hold" | "abort" | "skip_paused" | "skip_no_yield" | "error";
  status: "executed" | "failed" | "no_action" | "aborted" | "skipped" | "error";

  // Discovery state
  treasuryBalance: string;
  principal: string;
  availableYield: string;
  dailySpendRemaining: string;

  // Reasoning
  veniceAction: string;
  veniceReasoning: string;
  riskLevel: string;
  riskScore: number;
  marketSentiment: string;
  finalAction: string;
  strategyReasoning: string;

  // Swap details (if action = swap_yield)
  swapAmount?: string;
  tokenIn?: string;
  tokenOut?: string;
  swapPath?: string[];
  txHash?: string;
  router?: string;
  expectedOutput?: string;
  executionMode?: "mainnet" | "testnet_mock" | "testnet_spend" | "none";

  // Duration
  durationMs: number;

  // Error details
  error?: string;
}

export interface ActivityStats {
  totalCycles: number;
  totalSwaps: number;
  totalHolds: number;
  totalErrors: number;
  totalVolumeStETH: number;
  lastUpdated: string;
}

// ── Database Initialization ───────────────────────────────────────

let db: SqlJsDatabase | null = null;
let dbReady: Promise<void> | null = null;

/** Initialize the DB eagerly — call at agent startup */
export function initActivityStore(): void {
  dbReady = _initDB();
  dbReady.then(() => {
    console.log(`  📦 Activity DB initialized at ${DB_PATH}`);
  }).catch((err) => {
    console.error("  ⚠️ Failed to initialize activity DB:", (err as Error).message);
  });
}

async function _initDB(): Promise<void> {
  const SQL = await initSqlJs();

  // Load existing DB file if present
  if (existsSync(DB_PATH)) {
    try {
      const fileBuffer = readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } catch {
      console.warn("  ⚠️ Corrupt DB file, creating fresh database");
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      cycle INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      user TEXT NOT NULL,
      treasury_address TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      treasury_balance TEXT,
      principal TEXT,
      available_yield TEXT,
      daily_spend_remaining TEXT,
      venice_action TEXT,
      venice_reasoning TEXT,
      risk_level TEXT,
      risk_score REAL,
      market_sentiment TEXT,
      final_action TEXT,
      strategy_reasoning TEXT,
      swap_amount TEXT,
      token_in TEXT,
      token_out TEXT,
      swap_path TEXT,
      tx_hash TEXT,
      router TEXT,
      expected_output TEXT,
      execution_mode TEXT,
      duration_ms INTEGER,
      error TEXT
    );
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_activities_action ON activities(action)");
  db.run("CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user)");
  db.run("CREATE INDEX IF NOT EXISTS idx_activities_tx_hash ON activities(tx_hash)");

  // Persist to disk
  _saveDB();
}

function _saveDB(): void {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error("  ⚠️ Failed to save DB:", (err as Error).message);
  }
}

function getDB(): SqlJsDatabase | null {
  return db;
}

// ── Write Operations ─────────────────────────────────────────────

export function recordActivity(record: ActivityRecord): void {
  try {
    const d = getDB();
    if (!d) {
      console.warn("  ⚠️ Activity DB not ready yet, skipping record");
      return;
    }

    d.run(
      `INSERT OR REPLACE INTO activities (
        id, cycle, timestamp, user, treasury_address, action, status,
        treasury_balance, principal, available_yield, daily_spend_remaining,
        venice_action, venice_reasoning, risk_level, risk_score, market_sentiment,
        final_action, strategy_reasoning,
        swap_amount, token_in, token_out, swap_path, tx_hash, router,
        expected_output, execution_mode, duration_ms, error
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )`,
      [
        record.id,
        record.cycle,
        record.timestamp,
        record.user,
        record.treasuryAddress,
        record.action,
        record.status,
        record.treasuryBalance,
        record.principal,
        record.availableYield,
        record.dailySpendRemaining,
        record.veniceAction,
        record.veniceReasoning,
        record.riskLevel,
        record.riskScore,
        record.marketSentiment,
        record.finalAction,
        record.strategyReasoning,
        record.swapAmount ?? null,
        record.tokenIn ?? null,
        record.tokenOut ?? null,
        record.swapPath ? JSON.stringify(record.swapPath) : null,
        record.txHash ?? null,
        record.router ?? null,
        record.expectedOutput ?? null,
        record.executionMode ?? null,
        record.durationMs,
        record.error ?? null,
      ]
    );

    // Persist after each write
    _saveDB();
  } catch (err) {
    console.error("  ⚠️ Failed to record activity:", (err as Error).message);
  }
}

// ── Read Operations ──────────────────────────────────────────────

function rowToRecord(row: Record<string, any>): ActivityRecord {
  return {
    id: row.id,
    cycle: row.cycle,
    timestamp: row.timestamp,
    user: row.user,
    treasuryAddress: row.treasury_address,
    action: row.action,
    status: row.status,
    treasuryBalance: row.treasury_balance,
    principal: row.principal,
    availableYield: row.available_yield,
    dailySpendRemaining: row.daily_spend_remaining,
    veniceAction: row.venice_action,
    veniceReasoning: row.venice_reasoning,
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    marketSentiment: row.market_sentiment,
    finalAction: row.final_action,
    strategyReasoning: row.strategy_reasoning,
    swapAmount: row.swap_amount ?? undefined,
    tokenIn: row.token_in ?? undefined,
    tokenOut: row.token_out ?? undefined,
    swapPath: row.swap_path ? JSON.parse(row.swap_path) : undefined,
    txHash: row.tx_hash ?? undefined,
    router: row.router ?? undefined,
    expectedOutput: row.expected_output ?? undefined,
    executionMode: row.execution_mode ?? undefined,
    durationMs: row.duration_ms,
    error: row.error ?? undefined,
  };
}

/** Helper to run a SELECT and get results as objects */
function queryAll(sql: string, params: any[] = []): Record<string, any>[] {
  const d = getDB();
  if (!d) return [];
  const stmt = d.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: Record<string, any>[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql: string, params: any[] = []): Record<string, any> | null {
  const d = getDB();
  if (!d) return null;
  const stmt = d.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result: Record<string, any> | null = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

export function getActivities(
  limit = 50,
  offset = 0,
  filter?: "all" | "swaps"
): { records: ActivityRecord[]; total: number; stats: ActivityStats } {
  let whereClause = "";
  if (filter === "swaps") {
    whereClause = "WHERE action = 'swap_yield'";
  }

  const totalRow = queryOne(`SELECT COUNT(*) as cnt FROM activities ${whereClause}`);
  const total = totalRow?.cnt ?? 0;

  const rows = queryAll(
    `SELECT * FROM activities ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return {
    records: rows.map(rowToRecord),
    total,
    stats: getActivityStats(),
  };
}

export function getSwapActivities(limit = 50): ActivityRecord[] {
  const rows = queryAll(
    "SELECT * FROM activities WHERE action = 'swap_yield' ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
  return rows.map(rowToRecord);
}

export function getActivityStats(): ActivityStats {
  const totalCycles = queryOne("SELECT COUNT(*) as cnt FROM activities")?.cnt ?? 0;
  const totalSwaps = queryOne("SELECT COUNT(*) as cnt FROM activities WHERE action = 'swap_yield' AND status = 'executed'")?.cnt ?? 0;
  const totalHolds = queryOne("SELECT COUNT(*) as cnt FROM activities WHERE action = 'hold'")?.cnt ?? 0;
  const totalErrors = queryOne("SELECT COUNT(*) as cnt FROM activities WHERE status IN ('error', 'failed')")?.cnt ?? 0;
  const volumeRow = queryOne("SELECT COALESCE(SUM(CAST(swap_amount AS REAL)), 0) as vol FROM activities WHERE action = 'swap_yield' AND status = 'executed'");
  const lastRow = queryOne("SELECT timestamp FROM activities ORDER BY timestamp DESC LIMIT 1");

  return {
    totalCycles,
    totalSwaps,
    totalHolds,
    totalErrors,
    totalVolumeStETH: volumeRow?.vol ?? 0,
    lastUpdated: lastRow?.timestamp ?? new Date().toISOString(),
  };
}
