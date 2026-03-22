/**
 * Agent Execution Logger
 *
 * Produces structured agent_log.json entries as required by
 * Protocol Labs "Agents With Receipts" bounty and ERC-8004 compliance.
 *
 * Every log entry is stamped with the agent's DID (did:synthesis:34520)
 * and operator wallet - making the agent's identity load-bearing in
 * the audit trail, not decorative.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { v4 as uuid } from "uuid";
import { resolve } from "path";
import type { CycleLogEntry, AgentLog } from "../../types/index";

const LOG_PATH = resolve(process.cwd(), "agent_log.json");
const AGENT_JSON_PATH = resolve(process.cwd(), "agent.json");

// Load ERC-8004 identity from agent.json
let agentDid = "";
let agentOperator = "";
try {
  const manifest = JSON.parse(readFileSync(AGENT_JSON_PATH, "utf-8"));
  agentDid = manifest.did ?? "";
  agentOperator = manifest.operator?.contact ?? "";
} catch {
  // agent.json not found - DID will be empty
}

function loadLog(): AgentLog {
  if (existsSync(LOG_PATH)) {
    const raw = readFileSync(LOG_PATH, "utf-8").trim();
    if (raw) {
      try {
        const log = JSON.parse(raw) as AgentLog;
        // Ensure DID is always present (backfill older logs)
        if (!log.did) log.did = agentDid;
        if (!log.operator) log.operator = agentOperator;
        return log;
      } catch {
        // Corrupt JSON — start fresh
      }
    }
  }
  return { agent: "YieldsPilot", version: "1.0.0", did: agentDid, operator: agentOperator, cycles: [] };
}

function saveLog(log: AgentLog): void {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

/**
 * Log a complete agent cycle.
 */
export function logCycle(entry: Partial<CycleLogEntry> & { phase: CycleLogEntry["phase"]; action: string; status: CycleLogEntry["status"] }): CycleLogEntry {
  const log = loadLog();

  const fullEntry: CycleLogEntry = {
    id: entry.cycleId ?? uuid(),
    did: agentDid,  // ERC-8004: tie every action to agent identity
    timestamp: new Date().toISOString(),
    phase: entry.phase,
    action: entry.action,
    inputs: entry.inputs ?? {},
    outputs: entry.outputs ?? {},
    reasoning: entry.reasoning ?? null,
    txHash: entry.txHash ?? null,
    provider: entry.provider ?? null,
    model: entry.model ?? null,
    gasUsed: entry.gasUsed ?? null,
    duration: entry.duration ?? null,
    status: entry.status,
  };

  log.cycles.push(fullEntry);
  saveLog(log);

  return fullEntry;
}

/**
 * Log a full autonomous loop (discover → plan → execute → verify).
 */
export function logLoop({
  loopId,
  discover,
  plan,
  execute,
  verify,
}: {
  loopId?: string;
  discover: CycleLogEntry;
  plan: CycleLogEntry;
  execute: CycleLogEntry;
  verify: CycleLogEntry;
}): void {
  const log = loadLog();

  log.cycles.push({
    id: loopId ?? uuid(),
    type: "autonomous_loop",
    timestamp: new Date().toISOString(),
    phases: {
      discover,
      plan,
      execute,
      verify,
    },
    status: verify.status ?? "completed",
  } as any);

  saveLog(log);
}

/**
 * Get recent log entries.
 */
export function getRecentLogs(count = 10): AgentLog["cycles"] {
  const log = loadLog();
  return log.cycles.slice(-count);
}
