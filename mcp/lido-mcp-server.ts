/**
 * Lido MCP Server — Reference MCP Server for the Lido Protocol
 *
 * A standalone, general-purpose MCP server that lets any AI agent
 * interact with Lido's staking protocol on Ethereum mainnet (or Holesky testnet).
 *
 * Target: "A developer can point Claude or Cursor at this MCP server
 *          and stake ETH from conversation without custom integration code."
 *
 * Tools:
 *   - lido_stake        — Stake ETH → stETH via Lido
 *   - lido_unstake      — Request stETH withdrawal (Lido Withdrawal Queue)
 *   - lido_wrap          — Wrap stETH → wstETH (non-rebasing)
 *   - lido_unwrap        — Unwrap wstETH → stETH (rebasing)
 *   - lido_balances      — Query ETH, stETH, wstETH balances for any address
 *   - lido_rewards       — Protocol stats: total pooled, APR, exchange rates
 *   - lido_withdrawal_status — Check status of pending withdrawal requests
 *   - lido_delegate_vote — Delegate LDO governance voting power (Aragon)
 *   - lido_position_summary — Full staking position summary with P&L
 *
 * All write operations support dry_run.
 * See lido.skill.md for the agent mental model.
 *
 * Bounty: Lido "Lido MCP" ($5,000)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ════════════════════════════════════════════════════════════════
//                  LIDO PROTOCOL ADDRESSES
// ════════════════════════════════════════════════════════════════

// Mainnet (default) — https://docs.lido.fi/deployed-contracts
const MAINNET = {
  stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  withdrawalQueue: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
  ldo: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
  aragonVoting: "0x2e59A20f205bB85a89C53f1936454680651E618e",
  rpcDefault: "https://eth.llamarpc.com",
};

// Holesky testnet
const HOLESKY = {
  stETH: "0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034",
  wstETH: "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D",
  withdrawalQueue: "0xc7cc160b58F8Bb0baC94b80847E2CF2800565C50",
  ldo: "0x14ae7daeecdf57034f3E9db8564e46Dba8D97344",
  aragonVoting: "0x0000000000000000000000000000000000000000", // not deployed on Holesky
  rpcDefault: "https://ethereum-holesky-rpc.publicnode.com",
};

// ── Configuration ──────────────────────────────────────────────

const NETWORK = (process.env.LIDO_NETWORK ?? "mainnet").toLowerCase();
const isMainnet = NETWORK === "mainnet";
const addresses = isMainnet ? MAINNET : HOLESKY;

const RPC_URL = process.env.LIDO_RPC_URL ?? process.env.RPC_URL ?? addresses.rpcDefault;
const PRIVATE_KEY = process.env.LIDO_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY ?? "";

// ── Provider & Wallet ──────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
let wallet: ethers.Wallet | null = null;
let walletAddress = "";

if (PRIVATE_KEY) {
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  walletAddress = wallet.address;
}

// ── Contract ABIs ──────────────────────────────────────────────

const STETH_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function submit(address referral) payable returns (uint256)",
  "function getSharesByPooledEth(uint256 ethAmount) view returns (uint256)",
  "function getPooledEthByShares(uint256 sharesAmount) view returns (uint256)",
  "function getTotalShares() view returns (uint256)",
  "function getTotalPooledEther() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function sharesOf(address account) view returns (uint256)",
] as const;

const WSTETH_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function wrap(uint256 stETHAmount) returns (uint256)",
  "function unwrap(uint256 wstETHAmount) returns (uint256)",
  "function getStETHByWstETH(uint256 wstETHAmount) view returns (uint256)",
  "function getWstETHByStETH(uint256 stETHAmount) view returns (uint256)",
  "function stEthPerToken() view returns (uint256)",
  "function tokensPerStEth() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const WITHDRAWAL_QUEUE_ABI = [
  "function requestWithdrawals(uint256[] amounts, address owner) returns (uint256[])",
  "function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])",
  "function claimWithdrawals(uint256[] requestIds, uint256[] hints)",
  "function getLastRequestId() view returns (uint256)",
  "function getLastFinalizedRequestId() view returns (uint256)",
  "function unfinalizedStETH() view returns (uint256)",
  "function MIN_STETH_WITHDRAWAL_AMOUNT() view returns (uint256)",
  "function MAX_STETH_WITHDRAWAL_AMOUNT() view returns (uint256)",
] as const;

const LDO_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function delegate(address delegatee)",
  "function delegates(address account) view returns (address)",
] as const;

const ARAGON_VOTING_ABI = [
  "function votesLength() view returns (uint256)",
  "function getVote(uint256 voteId) view returns (bool open, bool executed, uint64 startDate, uint64 snapshotBlock, uint64 supportRequired, uint64 minAcceptQuorum, uint256 yea, uint256 nay, uint256 votingPower, bytes script)",
  "function vote(uint256 voteId, bool supports, bool executesIfDecided)",
  "function canVote(uint256 voteId, address voter) view returns (bool)",
] as const;

// ── Contract Instances ────────────────────────────────────────

const signer = wallet ?? provider;
const stETH = new ethers.Contract(addresses.stETH, STETH_ABI, signer);
const wstETH = new ethers.Contract(addresses.wstETH, WSTETH_ABI, signer);
const withdrawalQueue = new ethers.Contract(addresses.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, signer);
const ldo = new ethers.Contract(addresses.ldo, LDO_ABI, signer);
const aragonVoting = addresses.aragonVoting !== ethers.ZeroAddress
  ? new ethers.Contract(addresses.aragonVoting, ARAGON_VOTING_ABI, signer)
  : null;

// ════════════════════════════════════════════════════════════════
//                     MCP SERVER SETUP
// ════════════════════════════════════════════════════════════════

const server = new Server(
  { name: "lido-mcp", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ── Load skill documentation ─────────────────────────────────

let skillContent = "";
try {
  // Same directory as this server file
  const thisDir = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  const skillPath = resolve(thisDir, "lido.skill.md");
  skillContent = readFileSync(skillPath, "utf-8");
} catch {
  // Fallback: try repo root (standalone install puts it next to the server)
  try {
    const altPath = resolve(process.cwd(), "lido.skill.md");
    skillContent = readFileSync(altPath, "utf-8");
  } catch {
    skillContent = "# Lido Skill Documentation\n\nSkill file not found. See https://github.com/keplwch/yield-pilot/blob/main/lido.skill.md";
  }
}

// ════════════════════════════════════════════════════════════════
//                     RESOURCE: lido.skill.md
// ════════════════════════════════════════════════════════════════

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "lido://skill",
      name: "Lido Protocol Skill Guide",
      description:
        "Essential mental model for interacting with Lido: rebasing mechanics, stETH vs wstETH, withdrawal queue, governance, safe agent patterns, and contract addresses.",
      mimeType: "text/markdown",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "lido://skill") {
    return {
      contents: [
        {
          uri: "lido://skill",
          mimeType: "text/markdown",
          text: skillContent,
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${request.params.uri}`);
});

// ════════════════════════════════════════════════════════════════
//                     PROMPT: lido-agent-guide
// ════════════════════════════════════════════════════════════════

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "lido-agent-guide",
      description:
        "Injects the full Lido protocol mental model into conversation context. Use this before performing any Lido operations.",
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "lido-agent-guide") {
    return {
      description: "Lido protocol mental model for AI agents",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Please read and internalize this Lido protocol guide before using any Lido tools:\n\n${skillContent}`,
          },
        },
      ],
    };
  }
  throw new Error(`Unknown prompt: ${request.params.name}`);
});

// ════════════════════════════════════════════════════════════════
//                     TOOL DEFINITIONS
// ════════════════════════════════════════════════════════════════

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lido_stake",
      description:
        "Stake ETH to receive stETH via Lido. stETH is a rebasing token — your balance grows daily as staking rewards are distributed. Supports dry_run to preview without executing.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_eth: { type: "string", description: "Amount of ETH to stake (e.g., '1.5')" },
          dry_run: { type: "boolean", description: "If true, simulate without executing on-chain", default: false },
        },
        required: ["amount_eth"],
      },
    },
    {
      name: "lido_unstake",
      description:
        "Request withdrawal of stETH back to ETH via Lido's Withdrawal Queue (ERC-721 NFT receipt). Takes 1-5 days to finalize. Min withdrawal: 100 wei. Max: 1000 stETH per request. Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_steth: { type: "string", description: "Amount of stETH to withdraw (e.g., '1.0')" },
          dry_run: { type: "boolean", description: "If true, simulate without executing", default: false },
        },
        required: ["amount_steth"],
      },
    },
    {
      name: "lido_wrap",
      description:
        "Wrap stETH → wstETH. wstETH is non-rebasing (balance stays fixed, value increases). Use wstETH for DeFi (Uniswap, Aave, etc.) to avoid accounting issues with rebasing. Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          amount_steth: { type: "string", description: "Amount of stETH to wrap into wstETH" },
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
          amount_wsteth: { type: "string", description: "Amount of wstETH to unwrap back to stETH" },
          dry_run: { type: "boolean", description: "If true, simulate without executing", default: false },
        },
        required: ["amount_wsteth"],
      },
    },
    {
      name: "lido_balances",
      description:
        "Query ETH, stETH, and wstETH balances for any Ethereum address. Also returns the stETH share count (for tracking rewards independently of rebasing).",
      inputSchema: {
        type: "object" as const,
        properties: {
          address: { type: "string", description: "Ethereum address to query (defaults to connected wallet)" },
        },
      },
    },
    {
      name: "lido_rewards",
      description:
        "Get current Lido protocol statistics: total pooled ETH, total shares, stETH/wstETH exchange rate, estimated APR, and withdrawal queue status.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "lido_withdrawal_status",
      description:
        "Check the status of pending Lido withdrawal requests by their NFT request IDs. Returns whether each request is finalized and claimable.",
      inputSchema: {
        type: "object" as const,
        properties: {
          request_ids: {
            type: "array",
            items: { type: "number" },
            description: "Array of withdrawal request IDs (NFT token IDs from the Withdrawal Queue)",
          },
        },
        required: ["request_ids"],
      },
    },
    {
      name: "lido_delegate_vote",
      description:
        "Delegate LDO governance voting power to a specified address, or cast a vote on an active Aragon proposal. Supports dry_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["delegate", "vote", "list_votes"],
            description: "'delegate' to delegate LDO power, 'vote' to vote on a proposal, 'list_votes' to see recent proposals",
          },
          delegate_to: { type: "string", description: "Address to delegate LDO voting power to (for action=delegate)" },
          vote_id: { type: "number", description: "Aragon proposal/vote ID (for action=vote)" },
          support: { type: "boolean", description: "true=yea, false=nay (for action=vote)" },
          dry_run: { type: "boolean", description: "If true, preview without executing", default: false },
        },
        required: ["action"],
      },
    },
    {
      name: "lido_position_summary",
      description:
        "Full staking position summary for an address: balances, share value, estimated daily/annual rewards, and current protocol APR.",
      inputSchema: {
        type: "object" as const,
        properties: {
          address: { type: "string", description: "Ethereum address to analyze (defaults to connected wallet)" },
        },
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
  delegate_to?: string;
  action?: string;
  vote_id?: number;
  support?: boolean;
  request_ids?: number[];
  dry_run?: boolean;
}

function requireWallet(): ethers.Wallet {
  if (!wallet) throw new Error("No wallet configured. Set LIDO_PRIVATE_KEY or AGENT_PRIVATE_KEY in your .env to enable write operations.");
  return wallet;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as ToolArgs;

  try {
    let result: unknown;

    switch (name) {
      // ── STAKE ────────────────────────────────────────────────
      case "lido_stake": {
        requireWallet();
        const amount = ethers.parseEther(args.amount_eth!);
        const ethBal = await provider.getBalance(walletAddress);

        if (args.dry_run) {
          const shares = await stETH.getSharesByPooledEth(amount);
          const totalPooled = await stETH.getTotalPooledEther();
          const totalShares = await stETH.getTotalShares();
          const exchangeRate = Number(ethers.formatEther(totalPooled)) / Number(ethers.formatEther(totalShares));
          result = {
            dryRun: true,
            action: "stake",
            network: NETWORK,
            inputETH: args.amount_eth,
            expectedShares: ethers.formatUnits(shares, 18),
            estimatedStETH: args.amount_eth, // 1:1 on deposit
            currentExchangeRate: exchangeRate.toFixed(6),
            walletETHBalance: ethers.formatEther(ethBal),
            hasSufficientBalance: ethBal >= amount,
            lidoContract: addresses.stETH,
            note: "stETH is rebasing — your balance will grow daily as staking rewards accrue.",
          };
        } else {
          if (ethBal < amount) throw new Error(`Insufficient ETH: have ${ethers.formatEther(ethBal)}, need ${args.amount_eth}`);
          const tx = await stETH.submit(ethers.ZeroAddress, { value: amount });
          const receipt = await tx.wait();
          result = {
            action: "stake",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            inputETH: args.amount_eth,
            network: NETWORK,
            timestamp: new Date().toISOString(),
          };
        }
        break;
      }

      // ── UNSTAKE ──────────────────────────────────────────────
      case "lido_unstake": {
        requireWallet();
        const amount = ethers.parseEther(args.amount_steth!);
        const stEthBal = await stETH.balanceOf(walletAddress) as bigint;

        if (args.dry_run) {
          const lastFinalized = await withdrawalQueue.getLastFinalizedRequestId();
          const lastRequest = await withdrawalQueue.getLastRequestId();
          const unfinalizedTotal = await withdrawalQueue.unfinalizedStETH();
          result = {
            dryRun: true,
            action: "unstake",
            network: NETWORK,
            inputStETH: args.amount_steth,
            walletStETHBalance: ethers.formatEther(stEthBal),
            hasSufficientBalance: stEthBal >= amount,
            queueStatus: {
              lastFinalizedRequestId: lastFinalized.toString(),
              lastRequestId: lastRequest.toString(),
              pendingRequests: (lastRequest - lastFinalized).toString(),
              unfinalizedStETH: ethers.formatEther(unfinalizedTotal),
            },
            note: "Withdrawal takes 1-5 days. You receive an ERC-721 NFT as your claim ticket.",
            withdrawalQueueContract: addresses.withdrawalQueue,
          };
        } else {
          if (stEthBal < amount) throw new Error(`Insufficient stETH: have ${ethers.formatEther(stEthBal)}, need ${args.amount_steth}`);
          const approveTx = await stETH.approve(addresses.withdrawalQueue, amount);
          await approveTx.wait();
          const tx = await withdrawalQueue.requestWithdrawals([amount], walletAddress);
          const receipt = await tx.wait();
          result = {
            action: "unstake",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            inputStETH: args.amount_steth,
            network: NETWORK,
            note: "Withdrawal request submitted. Use lido_withdrawal_status to track finalization.",
            timestamp: new Date().toISOString(),
          };
        }
        break;
      }

      // ── WRAP ─────────────────────────────────────────────────
      case "lido_wrap": {
        requireWallet();
        const amount = ethers.parseEther(args.amount_steth!);
        const stEthBal = await stETH.balanceOf(walletAddress) as bigint;

        if (args.dry_run) {
          const expectedWstETH = await wstETH.getWstETHByStETH(amount);
          result = {
            dryRun: true,
            action: "wrap",
            network: NETWORK,
            inputStETH: args.amount_steth,
            expectedWstETH: ethers.formatEther(expectedWstETH),
            walletStETHBalance: ethers.formatEther(stEthBal),
            hasSufficientBalance: stEthBal >= amount,
            note: "wstETH is non-rebasing — use for DeFi (Uniswap, Aave, Morpho). Value increases over time instead of balance.",
          };
        } else {
          if (stEthBal < amount) throw new Error(`Insufficient stETH: have ${ethers.formatEther(stEthBal)}, need ${args.amount_steth}`);
          const approveTx = await stETH.approve(addresses.wstETH, amount);
          await approveTx.wait();
          const tx = await wstETH.wrap(amount);
          const receipt = await tx.wait();
          result = {
            action: "wrap",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            inputStETH: args.amount_steth,
            network: NETWORK,
            timestamp: new Date().toISOString(),
          };
        }
        break;
      }

      // ── UNWRAP ───────────────────────────────────────────────
      case "lido_unwrap": {
        requireWallet();
        const amount = ethers.parseEther(args.amount_wsteth!);
        const wstEthBal = await wstETH.balanceOf(walletAddress) as bigint;

        if (args.dry_run) {
          const expectedStETH = await wstETH.getStETHByWstETH(amount);
          result = {
            dryRun: true,
            action: "unwrap",
            network: NETWORK,
            inputWstETH: args.amount_wsteth,
            expectedStETH: ethers.formatEther(expectedStETH),
            walletWstETHBalance: ethers.formatEther(wstEthBal),
            hasSufficientBalance: wstEthBal >= amount,
            note: "Converting back to rebasing stETH. Your balance will start growing daily again.",
          };
        } else {
          if (wstEthBal < amount) throw new Error(`Insufficient wstETH: have ${ethers.formatEther(wstEthBal)}, need ${args.amount_wsteth}`);
          const tx = await wstETH.unwrap(amount);
          const receipt = await tx.wait();
          result = {
            action: "unwrap",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            inputWstETH: args.amount_wsteth,
            network: NETWORK,
            timestamp: new Date().toISOString(),
          };
        }
        break;
      }

      // ── BALANCES ─────────────────────────────────────────────
      case "lido_balances": {
        const addr = args.address ?? walletAddress;
        if (!addr) throw new Error("No address provided and no wallet configured. Pass an address or set LIDO_PRIVATE_KEY.");

        const [ethBal, stEthBal, wstEthBal, shares] = await Promise.all([
          provider.getBalance(addr),
          stETH.balanceOf(addr) as Promise<bigint>,
          wstETH.balanceOf(addr) as Promise<bigint>,
          stETH.sharesOf(addr) as Promise<bigint>,
        ]);

        // Calculate the ETH value of wstETH holdings
        let wstEthInStETH = 0n;
        if (wstEthBal > 0n) {
          wstEthInStETH = await wstETH.getStETHByWstETH(wstEthBal) as bigint;
        }

        const totalStaking = stEthBal + wstEthInStETH;

        result = {
          address: addr,
          network: NETWORK,
          eth: ethers.formatEther(ethBal),
          stETH: ethers.formatEther(stEthBal),
          wstETH: ethers.formatEther(wstEthBal),
          wstETHValueInStETH: ethers.formatEther(wstEthInStETH),
          totalStakingPosition: ethers.formatEther(totalStaking),
          shares: ethers.formatEther(shares),
          note: "stETH balance rebases daily. shares represent your fixed ownership proportion.",
        };
        break;
      }

      // ── REWARDS / PROTOCOL STATS ─────────────────────────────
      case "lido_rewards": {
        const [totalPooled, totalShares, stEthPerWst, lastFinalized, lastRequest, unfinalizedTotal] = await Promise.all([
          stETH.getTotalPooledEther() as Promise<bigint>,
          stETH.getTotalShares() as Promise<bigint>,
          wstETH.stEthPerToken() as Promise<bigint>,
          withdrawalQueue.getLastFinalizedRequestId().catch(() => 0n),
          withdrawalQueue.getLastRequestId().catch(() => 0n),
          withdrawalQueue.unfinalizedStETH().catch(() => 0n),
        ]);

        const exchangeRate = Number(ethers.formatEther(totalPooled)) / Number(ethers.formatEther(totalShares));

        result = {
          network: NETWORK,
          protocol: {
            totalPooledETH: ethers.formatEther(totalPooled),
            totalShares: ethers.formatEther(totalShares),
            shareExchangeRate: exchangeRate.toFixed(8),
            stETHPerWstETH: ethers.formatEther(stEthPerWst),
          },
          withdrawalQueue: {
            lastFinalizedRequestId: lastFinalized.toString(),
            lastRequestId: lastRequest.toString(),
            pendingRequests: (Number(lastRequest) - Number(lastFinalized)).toString(),
            unfinalizedStETH: ethers.formatEther(unfinalizedTotal),
          },
          apr: {
            note: "Lido APR fluctuates between ~3-5% annually. Check https://lido.fi/ethereum for real-time data.",
            estimatedAnnualPercent: "~3.0-4.5%",
          },
          contracts: {
            stETH: addresses.stETH,
            wstETH: addresses.wstETH,
            withdrawalQueue: addresses.withdrawalQueue,
          },
        };
        break;
      }

      // ── WITHDRAWAL STATUS ────────────────────────────────────
      case "lido_withdrawal_status": {
        const requestIds = args.request_ids ?? [];
        if (requestIds.length === 0) throw new Error("request_ids array is required and must not be empty.");

        const statuses = await withdrawalQueue.getWithdrawalStatus(requestIds);

        result = {
          network: NETWORK,
          requests: requestIds.map((id: number, i: number) => ({
            requestId: id,
            amountOfStETH: ethers.formatEther(statuses[i].amountOfStETH),
            amountOfShares: ethers.formatEther(statuses[i].amountOfShares),
            owner: statuses[i].owner,
            timestamp: new Date(Number(statuses[i].timestamp) * 1000).toISOString(),
            isFinalized: statuses[i].isFinalized,
            isClaimed: statuses[i].isClaimed,
            status: statuses[i].isClaimed
              ? "claimed"
              : statuses[i].isFinalized
              ? "ready_to_claim"
              : "pending",
          })),
        };
        break;
      }

      // ── GOVERNANCE ────────────────────────────────────────────
      case "lido_delegate_vote": {
        const govAction = args.action ?? "list_votes";

        if (govAction === "list_votes") {
          if (!aragonVoting) throw new Error("Aragon voting not available on this network.");
          const votesLength = await aragonVoting.votesLength();
          const count = Math.min(Number(votesLength), 5);
          const votes: unknown[] = [];

          for (let i = Number(votesLength) - 1; i >= Number(votesLength) - count && i >= 0; i--) {
            const v = await aragonVoting.getVote(i);
            votes.push({
              voteId: i,
              open: v.open,
              executed: v.executed,
              startDate: new Date(Number(v.startDate) * 1000).toISOString(),
              yea: ethers.formatEther(v.yea),
              nay: ethers.formatEther(v.nay),
              votingPower: ethers.formatEther(v.votingPower),
            });
          }

          result = {
            network: NETWORK,
            totalVotes: votesLength.toString(),
            recentVotes: votes,
            ldoToken: addresses.ldo,
            votingContract: addresses.aragonVoting,
          };

        } else if (govAction === "delegate") {
          requireWallet();
          if (!args.delegate_to) throw new Error("delegate_to address is required for delegation.");

          const ldoBal = await ldo.balanceOf(walletAddress) as bigint;

          if (args.dry_run) {
            const currentDelegate = await ldo.delegates(walletAddress).catch(() => ethers.ZeroAddress);
            result = {
              dryRun: true,
              action: "delegate",
              network: NETWORK,
              from: walletAddress,
              delegateTo: args.delegate_to,
              ldoBalance: ethers.formatEther(ldoBal),
              currentDelegate: currentDelegate,
              note: "This delegates your LDO voting power. The LDO tokens stay in your wallet.",
            };
          } else {
            const tx = await ldo.delegate(args.delegate_to);
            const receipt = await tx.wait();
            result = {
              action: "delegate",
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              delegateTo: args.delegate_to,
              network: NETWORK,
              timestamp: new Date().toISOString(),
            };
          }

        } else if (govAction === "vote") {
          requireWallet();
          if (!aragonVoting) throw new Error("Aragon voting not available on this network.");
          if (args.vote_id === undefined) throw new Error("vote_id is required for voting.");
          if (args.support === undefined) throw new Error("support (true/false) is required for voting.");

          if (args.dry_run) {
            const canVote = await aragonVoting.canVote(args.vote_id, walletAddress);
            const voteInfo = await aragonVoting.getVote(args.vote_id);
            result = {
              dryRun: true,
              action: "vote",
              network: NETWORK,
              voteId: args.vote_id,
              support: args.support,
              canVote,
              voteStatus: {
                open: voteInfo.open,
                currentYea: ethers.formatEther(voteInfo.yea),
                currentNay: ethers.formatEther(voteInfo.nay),
              },
              note: canVote
                ? "You are eligible to vote on this proposal."
                : "You cannot vote on this proposal (no LDO voting power at snapshot or already voted).",
            };
          } else {
            const tx = await aragonVoting.vote(args.vote_id, args.support, false);
            const receipt = await tx.wait();
            result = {
              action: "vote",
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              voteId: args.vote_id,
              support: args.support,
              network: NETWORK,
              timestamp: new Date().toISOString(),
            };
          }

        } else {
          throw new Error(`Unknown governance action: ${govAction}. Use 'delegate', 'vote', or 'list_votes'.`);
        }
        break;
      }

      // ── POSITION SUMMARY ──────────────────────────────────────
      case "lido_position_summary": {
        const addr = args.address ?? walletAddress;
        if (!addr) throw new Error("No address provided and no wallet configured.");

        const [ethBal, stEthBal, wstEthBal, shares, totalPooled, totalShares, stEthPerWst] = await Promise.all([
          provider.getBalance(addr),
          stETH.balanceOf(addr) as Promise<bigint>,
          wstETH.balanceOf(addr) as Promise<bigint>,
          stETH.sharesOf(addr) as Promise<bigint>,
          stETH.getTotalPooledEther() as Promise<bigint>,
          stETH.getTotalShares() as Promise<bigint>,
          wstETH.stEthPerToken() as Promise<bigint>,
        ]);

        let wstEthInStETH = 0n;
        if (wstEthBal > 0n) {
          wstEthInStETH = await wstETH.getStETHByWstETH(wstEthBal) as bigint;
        }

        const totalStaking = stEthBal + wstEthInStETH;
        const exchangeRate = Number(ethers.formatEther(totalPooled)) / Number(ethers.formatEther(totalShares));

        // Estimate daily rewards at ~3.5% APR
        const aprEstimate = 0.035;
        const totalStakingNum = Number(ethers.formatEther(totalStaking));
        const dailyReward = (totalStakingNum * aprEstimate) / 365;
        const annualReward = totalStakingNum * aprEstimate;

        result = {
          address: addr,
          network: NETWORK,
          balances: {
            eth: ethers.formatEther(ethBal),
            stETH: ethers.formatEther(stEthBal),
            wstETH: ethers.formatEther(wstEthBal),
            wstETHValueInStETH: ethers.formatEther(wstEthInStETH),
            totalStakingPosition: ethers.formatEther(totalStaking),
          },
          shares: {
            count: ethers.formatEther(shares),
            exchangeRate: exchangeRate.toFixed(8),
            note: "Shares represent your fixed ownership of the pool. As validators earn rewards, each share becomes worth more ETH.",
          },
          estimatedRewards: {
            aprPercent: (aprEstimate * 100).toFixed(1) + "%",
            dailyStETH: dailyReward.toFixed(8),
            annualStETH: annualReward.toFixed(4),
            note: "Estimates based on ~3.5% APR. Actual rewards vary with validator performance and network conditions.",
          },
          wstETHRate: ethers.formatEther(stEthPerWst),
          contracts: {
            stETH: addresses.stETH,
            wstETH: addresses.wstETH,
          },
        };
        break;
      }

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
  console.error(`Lido MCP Server running on stdio (${NETWORK})`);
  console.error(`  stETH:  ${addresses.stETH}`);
  console.error(`  wstETH: ${addresses.wstETH}`);
  console.error(`  Queue:  ${addresses.withdrawalQueue}`);
  console.error(`  Wallet: ${walletAddress || "read-only (no private key)"}`);
}

main().catch(console.error);
