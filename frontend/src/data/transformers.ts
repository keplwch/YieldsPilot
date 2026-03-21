/**
 * Transforms raw agent log entries into UI-ready data structures.
 * No mock or fallback data — components handle empty states themselves.
 */

export interface FeedItem {
  phase: "discover" | "plan" | "execute" | "verify" | "alert" | "error";
  icon: string;
  title: string;
  desc: string;
  time: string;
  tx: string | null;
}

interface RawCycleLog {
  timestamp?: string;
  phase?: string;
  action?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  reasoning?: string | null;
  txHash?: string | null;
  duration?: number | null;
  status?: string;
}

interface RawLoopLog {
  type?: string;
  // New format: phases nested under `phases` key
  phases?: {
    discover?: RawCycleLog;
    plan?: RawCycleLog;
    execute?: RawCycleLog;
    verify?: RawCycleLog;
  };
  // Old format: phases at top level
  discover?: RawCycleLog;
  plan?: RawCycleLog;
  execute?: RawCycleLog;
  verify?: RawCycleLog;
}

// ── Helpers ───────────────────────────────────────────────────────

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const phaseIcons: Record<string, string> = {
  discover: "Radio",
  plan: "Brain",
  execute: "Zap",
  verify: "CheckCircle",
  error: "AlertTriangle",
  alert: "Bell",
};

// ── Feed items ────────────────────────────────────────────────────

export function logsToFeedItems(cycles: Array<RawCycleLog | RawLoopLog>): FeedItem[] {
  const items: FeedItem[] = [];

  for (const entry of cycles) {
    // Handle LoopLogEntry — supports new `phases` key and old top-level format
    if ((entry as RawLoopLog).type === "autonomous_loop" || (entry as RawLoopLog).discover || (entry as RawLoopLog).phases) {
      const loop = entry as RawLoopLog;
      const phaseData = loop.phases ?? loop;
      for (const phase of ["verify", "execute", "plan", "discover"] as const) {
        const log = (phaseData as Record<string, RawCycleLog | undefined>)[phase];
        if (log) items.push(cycleLogToFeedItem(log));
      }
    } else {
      items.push(cycleLogToFeedItem(entry as RawCycleLog));
    }
  }

  return items.reverse().slice(0, 20);
}

function cycleLogToFeedItem(log: RawCycleLog): FeedItem {
  const phase = (log.phase ?? "discover") as FeedItem["phase"];
  const outputs = log.outputs ?? {};

  let title = `${phase.charAt(0).toUpperCase() + phase.slice(1)}: ${log.action ?? "unknown"}`;
  let desc = "";

  switch (phase) {
    case "discover": {
      const treasury = (outputs.balances as Record<string, unknown> | undefined)?.treasury as Record<string, unknown> | undefined;
      title = "State discovered";
      desc = treasury
        ? `Treasury: ${treasury.totalBalance ?? "?"} stETH | Principal: ${treasury.principal ?? "?"} | Yield: ${treasury.availableYield ?? "?"}`
        : log.reasoning ?? JSON.stringify(outputs).slice(0, 120);
      break;
    }
    case "plan": {
      title = "Multi-model reasoning complete";
      const vd = outputs.veniceDecision as string | undefined;
      desc = vd
        ? `Venice (private): ${vd}. Risk=${outputs.riskLevel ?? "?"}. Market=${outputs.marketSentiment ?? "?"}. Action: ${outputs.finalAction ?? "?"}`
        : log.reasoning ?? "Multi-model analysis completed.";
      break;
    }
    case "execute": {
      const action = outputs.action as string || log.action || "hold";
      title = `Action: ${action.toUpperCase()}`;
      const strategyReasoning = (log.inputs?.strategy as Record<string, unknown> | undefined)?.reasoning as string | undefined;
      desc = outputs.reason as string ?? strategyReasoning ?? log.reasoning ?? `Executed ${action} with status: ${log.status ?? "?"}`;
      break;
    }
    case "verify": {
      title = "Post-execution verified";
      const actionTaken = outputs.actionTaken as string | undefined;
      const duration = (outputs.duration ?? log.duration) as number | undefined;
      desc = `Action: ${actionTaken ?? "?"}. Duration: ${duration ?? "?"}ms. Status: ${log.status ?? "?"}`;
      if (log.txHash) desc += ` | Tx: ${log.txHash}`;
      break;
    }
    case "error": {
      title = "Cycle error";
      desc = (outputs.error as string | undefined)?.split("\n")[0] ?? "Unexpected error during cycle.";
      break;
    }
    default:
      desc = log.reasoning ?? JSON.stringify(outputs).slice(0, 120);
  }

  return {
    phase,
    icon: phaseIcons[phase] ?? "Activity",
    title,
    desc,
    time: log.timestamp ? timeAgo(log.timestamp) : "now",
    tx: log.txHash ?? null,
  };
}

// ── Reasoning lines ───────────────────────────────────────────────

export function logsToReasoningLines(
  cycles: Array<RawCycleLog | RawLoopLog>
): Array<{ prefix: string; text: string; isPrivate?: boolean }> {
  const lines: Array<{ prefix: string; text: string; isPrivate?: boolean }> = [];

  const recent = cycles.slice(-3);

  for (const entry of recent) {
    const asLoop = entry as RawLoopLog;
    const phaseData = asLoop.phases ?? (asLoop.discover ? asLoop : null);

    if (phaseData) {
      if (phaseData.discover) {
        const bal = (phaseData.discover.outputs?.balances as Record<string, unknown>)?.treasury as Record<string, unknown> | undefined;
        const proto = phaseData.discover.outputs?.protocolStats as Record<string, unknown> | undefined;
        lines.push({
          prefix: "[discover]",
          text: bal
            ? `Treasury: ${bal.totalBalance} stETH | Principal: ${bal.principal} | Yield: ${bal.availableYield}${proto ? ` | Rate: ${proto.exchangeRate}` : ""}`
            : "Discovering current state...",
        });
      }

      if (phaseData.plan) {
        const outputs = phaseData.plan.outputs ?? {};
        if (outputs.veniceDecision) {
          lines.push({ prefix: "[venice  ]", text: `${outputs.veniceDecision}`, isPrivate: true });
        }
        if (outputs.riskLevel) {
          lines.push({ prefix: "[bankr   ]", text: `Risk: ${outputs.riskLevel} | Market: ${outputs.marketSentiment} | Action: ${outputs.finalAction}` });
        } else if (phaseData.plan.reasoning) {
          lines.push({ prefix: "[plan    ]", text: phaseData.plan.reasoning });
        }
      }

      if (phaseData.execute) {
        const action = phaseData.execute.outputs?.action as string ?? phaseData.execute.action ?? "hold";
        const strategyReasoning = (phaseData.execute.inputs?.strategy as Record<string, unknown> | undefined)?.reasoning as string | undefined;
        lines.push({
          prefix: "[execute ]",
          text: strategyReasoning ? `${action.toUpperCase()} — ${strategyReasoning.slice(0, 90)}` : `Action: ${action}. Status: ${phaseData.execute.status}`,
        });
      }

      if (phaseData.verify) {
        const dur = (phaseData.verify.outputs?.duration as number | undefined) ?? phaseData.verify.duration ?? undefined;
        lines.push({ prefix: "[verify  ]", text: `Post-check: ${phaseData.verify.status} | Duration: ${dur ?? "?"}ms` });
      }
    } else {
      const log = entry as RawCycleLog;
      if (log.phase === "error") continue;

      let prefix = `[${(log.phase ?? "?").padEnd(8)}]`;
      let text = "";
      let isPrivate = false;

      switch (log.phase) {
        case "discover": {
          const bal = (log.outputs?.balances as Record<string, unknown>)?.treasury as Record<string, unknown> | undefined;
          const proto = log.outputs?.protocolStats as Record<string, unknown> | undefined;
          prefix = "[discover]";
          text = bal
            ? `Treasury: ${bal.totalBalance} stETH | Principal: ${bal.principal} | Yield: ${bal.availableYield}${proto ? ` | Rate: ${proto.exchangeRate}` : ""}`
            : "Discovering current state...";
          break;
        }
        case "plan": {
          const outputs = log.outputs ?? {};
          if (outputs.veniceDecision) {
            prefix = "[venice  ]";
            text = `${outputs.veniceDecision}`;
            isPrivate = true;
          } else {
            prefix = "[bankr   ]";
            text = log.reasoning ?? `Risk: ${outputs.riskLevel} | Market: ${outputs.marketSentiment} | Action: ${outputs.finalAction}`;
          }
          break;
        }
        case "execute": {
          const action = log.outputs?.action as string ?? log.action ?? "hold";
          const strategyReasoning = (log.inputs?.strategy as Record<string, unknown> | undefined)?.reasoning as string | undefined;
          prefix = "[execute ]";
          text = strategyReasoning ? `${action.toUpperCase()} — ${strategyReasoning.slice(0, 90)}` : `Action: ${action}. Status: ${log.status}`;
          break;
        }
        case "verify": {
          const dur = (log.outputs?.duration ?? log.duration) as number | undefined;
          prefix = "[verify  ]";
          text = `Post-check: ${log.status} | Duration: ${dur ?? "?"}ms`;
          break;
        }
        default:
          text = log.reasoning ?? log.action ?? "...";
      }

      lines.push({ prefix, text, isPrivate });
    }
  }

  return lines;
}

// ── Cycle metadata ───────────────────────────────────────────────

export function getCycleTimestamp(cycle: RawCycleLog | RawLoopLog): string | undefined {
  const loop = cycle as RawLoopLog;
  const phaseData = loop.phases ?? (loop.discover ? loop : null);
  if (phaseData) {
    return phaseData.discover?.timestamp ?? phaseData.plan?.timestamp ?? phaseData.execute?.timestamp;
  }
  return (cycle as RawCycleLog).timestamp;
}

// ── Yield chart ───────────────────────────────────────────────────

export interface YieldChartBar {
  cycle: number;
  total: number;
  segments: Array<{ user: string; yield: number }>;
}

export function apiYieldToChartData(
  history: Array<{ date: string; yield: number; balance: number; user?: string | null; cycle?: number | null }> | undefined
): YieldChartBar[] {
  if (!history || history.length === 0) return [];

  const byKey = new Map<number, YieldChartBar>();
  for (const h of history) {
    const key = h.cycle ?? 0;
    if (!byKey.has(key)) {
      byKey.set(key, { cycle: key, total: 0, segments: [] });
    }
    const bar = byKey.get(key)!;
    const y = h.yield ?? 0;
    const user = h.user ?? "unknown";
    const existing = bar.segments.find((s) => s.user === user);
    if (existing) {
      existing.yield = Math.max(existing.yield, y);
    } else {
      bar.segments.push({ user, yield: y });
    }
    bar.total = bar.segments.reduce((s, seg) => s + seg.yield, 0);
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-20);
}
