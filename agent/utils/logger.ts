/**
 * Agent Execution Logger
 *
 * Produces structured agent_log.json entries as required by
 * Protocol Labs "Let the Agent Cook" bounty and ERC-8004 compliance.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { v4 as uuid } from "uuid";
import { resolve } from "path";
import type { CycleLogEntry, AgentLog } from "../../types/index";

const LOG_PATH = resolve(process.cwd(), "agent_log.json");

function loadLog(): AgentLog {
  if (existsSync(LOG_PATH)) {
    return JSON.parse(readFileSync(LOG_PATH, "utf-8")) as AgentLog;
  }
  return { agent: "YieldPilot", version: "1.0.0", cycles: [] };
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
