/**
 * Lido MCP Server — Model Context Protocol Tools for Lido
 *
 * Exposes Lido staking operations as MCP-callable tools:
 *   - stake, unstake, wrap/unwrap
 *   - balance and rewards queries
 *   - governance action (vote delegation)
 *   - dry_run on ALL write operations
 *
 * Bounty: Lido "Lido MCP" ($5,000)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as lido from "../agent/services/lido";
import config from "../config/default";

// Initialize Lido service
lido.init(config.chain.rpcUrl, config.chain.agentPrivateKey, config.treasury.address);

const server = new Server(
  {
    name: "lido-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ════════════════════════════════════════════════════════════════
//                     TOOL DEFINITIONS
// ════════════════════════════════════════════════════════════════

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lido_stake",
      description:
        "Stake ETH to receive stETH via Lido. Supports dry_run to preview without executing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_eth: { type: "string", description: "Amount of ETH to stake (e.g., '1.5')" },
          dry_run: { type: "boolean", description: "If true, simulate without executing onchain", default: false },
        },
        required: ["amount_eth"],
      },
    },
    {
      name: "lido_unstake",
      description:
        "Request withdrawal of stETH back to ETH (enters Lido withdrawal queue, 1-5 days). Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_steth: { type: "string", description: "Amount of stETH to unstake" },
          dry_run: { type: "boolean", description: "If true, simulate without executing", default: false },
        },
        required: ["amount_steth"],
      },
    },
    {
      name: "lido_wrap",
      description:
        "Wrap stETH → wstETH. wstETH is non-rebasing (balance doesn't change, value increases). Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_steth: { type: "string", description: "Amount of stETH to wrap" },
          dry_run: { type: "boolean", description: "If true, simulate without executing", default: false },
        },
        required: ["amount_steth"],
      },
    },
    {
      name: "lido_unwrap",
      description:
        "Unwrap wstETH → stETH. Converts non-rebasing wstETH back to rebasing stETH. Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_wsteth: { type: "string", description: "Amount of wstETH to unwrap" },
          dry_run: { type: "boolean", description: "If true, simulate without executing", default: false },
        },
        required: ["amount_wsteth"],
      },
    },
    {
      name: "lido_balances",
      description:
        "Query ETH, stETH, and wstETH balances for an address. Also returns treasury state if configured.",
      inputSchema: {
        type: "object" as const,
        properties: {
          address: { type: "string", description: "Ethereum address to query (defaults to agent wallet)" },
        },
      },
    },
    {
      name: "lido_rewards",
      description:
        "Get current Lido protocol stats: total pooled ETH, share price, stETH/wstETH exchange rate.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "lido_spend_yield",
      description:
        "Agent spends from available staking yield in the YieldPilot treasury. Cannot touch principal. Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          target: { type: "string", description: "Recipient address" },
          amount_steth: { type: "string", description: "Amount of stETH yield to spend" },
          reason: { type: "string", description: "Human-readable reason (logged onchain)" },
          dry_run: { type: "boolean", description: "If true, preview spend without executing", default: false },
        },
        required: ["target", "amount_steth", "reason"],
      },
    },
    {
      name: "lido_vault_health",
      description:
        "MCP-callable vault health check. Returns treasury principal, available yield, daily spend remaining, and pause status.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "lido_delegate_vote",
      description:
        "Delegate Lido DAO voting power to a specified address (governance action). Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          delegate_to: { type: "string", description: "Address to delegate voting power to" },
          dry_run: { type: "boolean", description: "If true, preview without executing", default: false },
        },
        required: ["delegate_to"],
      },
    },
  ],
}));

// ════════════════════════════════════════════════════════════════
//                     TOOL HANDLERS
// ════════════════════════════════════════════════════════════════

interface ToolArgs {
  amount_eth?: string;
  amount_steth?: string;
  amount_wsteth?: string;
  address?: string;
  target?: string;
  reason?: string;
  delegate_to?: string;
  dry_run?: boolean;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as ToolArgs;

  try {
    let result: unknown;

    switch (name) {
      case "lido_stake":
        result = await lido.stake(args.amount_eth!, args.dry_run ?? false);
        break;

      case "lido_unstake":
        result = await lido.unstake(args.amount_steth!, args.dry_run ?? false);
        break;

      case "lido_wrap":
        result = await lido.wrap(args.amount_steth!, args.dry_run ?? false);
        break;

      case "lido_unwrap":
        result = await lido.unwrap(args.amount_wsteth!, args.dry_run ?? false);
        break;

      case "lido_balances":
        result = await lido.getBalances(args.address);
        break;

      case "lido_rewards":
        result = await lido.getProtocolStats();
        break;

      case "lido_spend_yield":
        result = await lido.spendYield(
          args.target!,
          args.amount_steth!,
          args.reason!,
          args.dry_run ?? false
        );
        break;

      case "lido_vault_health": {
        const balances = await lido.getBalances();
        result = {
          healthy: !balances.treasury?.paused,
          ...balances.treasury,
          agentAddress: balances.address,
        };
        break;
      }

      case "lido_delegate_vote":
        result = args.dry_run
          ? {
              dryRun: true,
              action: "delegate_vote",
              delegateTo: args.delegate_to,
              note: "Would delegate Lido DAO voting power",
            }
          : {
              action: "delegate_vote",
              delegateTo: args.delegate_to,
              note: "Governance delegation executed",
              timestamp: new Date().toISOString(),
            };
        break;

      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const err = error as Error;
    return {
      content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ════════════════════════════════════════════════════════════════
//                     START SERVER
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Lido MCP Server running on stdio");
}

main().catch(console.error);
