/**
 * MCP Server Integration Test
 *
 * Tests all 9 tools exposed by the Lido MCP server using
 * newline-delimited JSON-RPC (MCP SDK v1.27+ protocol).
 *
 * Tests against real Lido mainnet contracts (read-only + dry_run).
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";

const MCP_SCRIPT = path.resolve(__dirname, "mcp/lido-mcp-server.ts");

let reqId = 0;

interface TestResult {
  tool: string;
  status: "PASS" | "FAIL" | "ERROR";
  message: string;
  response?: unknown;
  durationMs: number;
}

const results: TestResult[] = [];

// A well-known address with stETH holdings for testing reads (Lido treasury)
const LIDO_TREASURY = "0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c";

async function runTest(): Promise<void> {
  console.log("=== Lido MCP Server — Integration Test Suite ===\n");

  const proc: ChildProcess = spawn("npx", ["tsx", MCP_SCRIPT], {
    cwd: path.resolve(__dirname),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      LIDO_NETWORK: "mainnet",
      LIDO_RPC_URL: process.env.LIDO_RPC_URL ?? "https://eth.llamarpc.com",
    },
  });

  const waiters: Map<number, (value: any) => void> = new Map();
  let buffer = "";

  proc.stdout!.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && waiters.has(msg.id)) {
          waiters.get(msg.id)!(msg);
          waiters.delete(msg.id);
        }
      } catch { /* skip */ }
    }
  });

  let stderrOutput = "";
  proc.stderr!.on("data", (data: Buffer) => {
    stderrOutput += data.toString();
  });

  function send(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n";
      const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
      waiters.set(id, (resp: any) => { clearTimeout(timer); resolve(resp); });
      proc.stdin!.write(msg);
    });
  }

  function notify(method: string, params?: Record<string, unknown>): void {
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }) + "\n");
  }

  async function testTool(toolName: string, args: Record<string, unknown>, description: string, expectError = false): Promise<void> {
    const start = Date.now();
    try {
      const response = await send("tools/call", { name: toolName, arguments: args });
      const elapsed = Date.now() - start;

      if (response.error) {
        results.push({
          tool: toolName, status: expectError ? "PASS" : "FAIL",
          message: `${description} — RPC error: ${response.error.message ?? JSON.stringify(response.error)}`,
          response: response.error, durationMs: elapsed,
        });
      } else if (response.result?.isError) {
        const text = response.result.content?.[0]?.text ?? "unknown";
        results.push({
          tool: toolName, status: expectError ? "PASS" : "FAIL",
          message: `${description}${expectError ? " (expected error)" : ""} — ${text}`,
          response: text, durationMs: elapsed,
        });
      } else {
        const text = response.result?.content?.[0]?.text ?? "";
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        results.push({
          tool: toolName, status: "PASS",
          message: description, response: parsed, durationMs: elapsed,
        });
      }
    } catch (err) {
      results.push({
        tool: toolName, status: "ERROR",
        message: `${description} — ${(err as Error).message}`, durationMs: Date.now() - start,
      });
    }
  }

  try {
    await new Promise((r) => setTimeout(r, 2000));

    // 1. Initialize
    console.log("1. Initializing MCP connection...");
    const initResp = await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    if (initResp.error) { console.error("   ❌ Init failed:", initResp.error); proc.kill(); return; }
    console.log(`   ✅ ${initResp.result?.serverInfo?.name} v${initResp.result?.serverInfo?.version}`);

    notify("notifications/initialized");
    await new Promise((r) => setTimeout(r, 500));

    // 2. List tools
    console.log("\n2. Listing tools...");
    const toolsResp = await send("tools/list");
    const tools = toolsResp.result?.tools ?? [];
    console.log(`   ✅ ${tools.length} tools:`);
    for (const t of tools) console.log(`      • ${t.name}`);

    // 3. Test tools
    console.log("\n3. Testing against Ethereum Mainnet...\n");

    // ── READ TOOLS ──
    console.log("   📖 [lido_balances] Lido Treasury address...");
    await testTool("lido_balances", { address: LIDO_TREASURY }, "Query Lido Treasury balances on mainnet");

    console.log("   📖 [lido_rewards] Protocol stats...");
    await testTool("lido_rewards", {}, "Query Lido protocol stats (mainnet)");

    console.log("   📖 [lido_position_summary] Position analysis...");
    await testTool("lido_position_summary", { address: LIDO_TREASURY }, "Full position summary for Lido Treasury");

    // ── DRY-RUN WRITE TOOLS ──
    console.log("   🧪 [lido_stake] dry_run=true...");
    await testTool("lido_stake", { amount_eth: "1.0", dry_run: true }, "Dry-run stake 1 ETH on mainnet");

    console.log("   🧪 [lido_unstake] dry_run=true...");
    await testTool("lido_unstake", { amount_steth: "1.0", dry_run: true }, "Dry-run unstake 1 stETH");

    console.log("   🧪 [lido_wrap] dry_run=true...");
    await testTool("lido_wrap", { amount_steth: "1.0", dry_run: true }, "Dry-run wrap 1 stETH → wstETH");

    console.log("   🧪 [lido_unwrap] dry_run=true...");
    await testTool("lido_unwrap", { amount_wsteth: "1.0", dry_run: true }, "Dry-run unwrap 1 wstETH → stETH");

    // ── GOVERNANCE ──
    console.log("   🏛️  [lido_delegate_vote] list_votes...");
    await testTool("lido_delegate_vote", { action: "list_votes" }, "List recent Lido DAO votes");

    console.log("   🧪 [lido_delegate_vote] dry_run delegate...");
    await testTool("lido_delegate_vote", {
      action: "delegate",
      delegate_to: "0x0000000000000000000000000000000000000001",
      dry_run: true,
    }, "Dry-run delegate LDO voting power");

    // ── EDGE CASES ──
    console.log("   ❓ [unknown_tool]...");
    await testTool("nonexistent_tool", {}, "Unknown tool returns error", true);

    console.log("   ❓ [lido_withdrawal_status] empty IDs...");
    await testTool("lido_withdrawal_status", { request_ids: [] }, "Empty request_ids should error", true);

  } catch (err) {
    console.error("\nTest suite error:", (err as Error).message);
  }

  proc.kill();

  // ── RESULTS ──
  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("                    MCP TEST RESULTS");
  console.log("════════════════════════════════════════════════════════════\n");

  let pass = 0, fail = 0, error = 0;

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⚠️";
    console.log(`${icon} ${r.tool} (${r.durationMs}ms) — ${r.status}`);
    console.log(`   ${r.message}`);
    if (r.response) {
      const s = JSON.stringify(r.response);
      console.log(`   → ${s.substring(0, 250)}${s.length > 250 ? "..." : ""}`);
    }
    console.log();
    if (r.status === "PASS") pass++;
    else if (r.status === "FAIL") fail++;
    else error++;
  }

  console.log(`────────────────────────────────────────`);
  console.log(`TOTAL: ${results.length} | ✅ ${pass} passed | ❌ ${fail} failed | ⚠️ ${error} errors`);

  if (stderrOutput) {
    console.log("\n── Server stderr ──");
    for (const l of stderrOutput.split("\n").filter(l => l.trim()).slice(0, 10)) console.log(`   ${l}`);
  }

  process.exit(fail + error > 0 ? 1 : 0);
}

runTest().catch(console.error);
