# YieldsPilot — Autonomous DeFi Agent with Privacy-Preserving Yield Management

> **Private cognition. Trusted onchain action.**

YieldsPilot is an autonomous AI agent that manages staking yield on behalf of a user. You deposit ETH, it earns yield via Lido stETH (or wstETH), the agent privately reasons about how to manage that yield (swap, rebalance, compound), and every action is executed and verified onchain. **The agent can never touch your principal.**

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    HUMAN (You)                          │
│   Deposit 32 ETH → stETH → YieldsPilot Treasury         │
│   Principal: LOCKED    |  Yield: AGENT-MANAGED          │
└─────────────────────────┬───────────────────────────────┘
                          │ yield accrues daily (rebasing)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              YIELDPILOT AGENT LOOP                      │
│                                                         │
│  1. DISCOVER  │ Check treasury balance, yield, rates    │
│  2. PLAN      │ Venice (private) + Bankr (multi-model)  │
│  3. EXECUTE   │ Swap on Uniswap / Rebalance / Hold     │
│  4. VERIFY    │ Confirm onchain state matches intent    │
│                                                         │
│  Every action logged → agent_log.json (ERC-8004)        │
└─────────────────────────────────────────────────────────┘
```

## Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Treasury** | Solidity 0.8.24 + OpenZeppelin | Yield-separated vault (principal locked, yield spendable) |
| **Private Reasoning** | Venice AI (no-data-retention) | Agent thinks privately, acts publicly |
| **Multi-Model Analysis** | Bankr LLM Gateway | Risk (GPT-4o) + Market (Claude) + Strategy (Llama) |
| **Swap Execution** | Uniswap Trading API | Real token swaps with real TxIDs |
| **Staking Ops** | Lido SDK + MCP | Stake, unstake, wrap, unwrap, balance queries |
| **Monitoring** | Vault Monitor + Telegram | Real-time alerts on yield changes |
| **Identity** | ERC-8004 | Onchain agent identity with structured logs |
| **Dashboard** | React + Vite + Tailwind | Beautiful real-time agent monitoring UI |

## Bounties Targeted

| Sponsor | Bounty | Prize | How We Qualify |
|---------|--------|-------|----------------|
| **Venice** | Private Agents, Trusted Actions | $11,500 | All reasoning via Venice no-data-retention API |
| **Protocol Labs** | Let the Agent Cook | $8,000 | Full autonomous discover→plan→execute→verify loop |
| **Protocol Labs** | Agents With Receipts (ERC-8004) | $8,004 | agent.json + agent_log.json + onchain identity |
| **Lido** | stETH Agent Treasury | $3,000 | Yield-separated smart contract with configurable permissions |
| **Lido** | Vault Position Monitor | $1,500 | Real-time vault monitoring + Telegram alerts |
| **Lido** | Lido MCP | $5,000 | 9 MCP tools: stake/unstake/wrap/unwrap/balance/rewards/spend/health/vote |
| **Uniswap** | Agentic Finance | $5,000 | Real swaps via Uniswap Trading API with TxIDs |
| **Bankr** | Best LLM Gateway Use | $5,000 | 3 models for risk/market/strategy via Bankr |
| **Status** | Go Gasless | $2,000 | Deploy + gasless tx on Status Network Sepolia |
| **Synthesis** | Open Track | $14,500 | Cross-sponsor coherent build with real utility |
| | **Total Potential** | **$63,504** | |

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/yield-pilot.git
cd yield-pilot
npm install
cd frontend && npm install && cd ..
```

### 2. Configure

```bash
cp .env.example .env
# Fill in your API keys:
#   VENICE_API_KEY    — from venice.ai
#   BANKR_API_KEY     — from bankr.chat
#   UNISWAP_API_KEY   — from developer.uniswap.org
#   AGENT_PRIVATE_KEY — agent wallet (testnet!)
#   RPC_URL           — Alchemy/Infura endpoint
#   TELEGRAM_BOT_TOKEN — optional, for alerts
```

### 3. Deploy Treasury Contract

```bash
# Compile contracts
npx hardhat compile

# Run tests (25 passing)
npx hardhat test

# Deploy to Ethereum Sepolia
./scripts/deploy.sh sepolia

# Deploy to Status Network Sepolia (bonus gasless bounty)
./scripts/deploy.sh status

# Deploy to all networks at once
./scripts/deploy.sh all

# Verify on Etherscan
./scripts/deploy.sh verify 0xYOUR_CONTRACT_ADDRESS
```

### 4. Run Everything Locally

```bash
# Install + start all services (frontend, agent, monitor)
./scripts/dev.sh start

# Or individually:
./scripts/dev.sh frontend   # React dashboard on :5173
./scripts/dev.sh agent      # Autonomous agent loop
./scripts/dev.sh monitor    # Vault monitor + Telegram

# Check status
./scripts/dev.sh status

# View logs
./scripts/dev.sh logs

# Stop everything
./scripts/dev.sh stop
```

### 5. Production (Docker)

```bash
./scripts/prod.sh up        # Starts agent + monitor + dashboard (nginx on :3000)
./scripts/prod.sh logs      # Tail logs
./scripts/prod.sh stop      # Stop all services
```

### 6. Use the Lido MCP Server

The Lido MCP server is a **standalone** reference MCP server for the Lido staking protocol. It talks to real Lido mainnet contracts (stETH, wstETH, Withdrawal Queue, Aragon DAO) and works with Claude Desktop, Cursor, or any MCP-compatible client. You do NOT need to clone the full repo to use it.

#### Option A: Quick Setup (standalone — no full repo needed)

```bash
# 1. Create a folder and install only what the MCP server needs
mkdir lido-mcp && cd lido-mcp
npm init -y
npm install @modelcontextprotocol/sdk ethers dotenv tsx

# 2. Download the two files you need from the repo
curl -O https://raw.githubusercontent.com/keplwch/yield-pilot/main/mcp/lido-mcp-server.ts
curl -O https://raw.githubusercontent.com/keplwch/yield-pilot/main/mcp/lido.skill.md

# 3. Create a .env (optional — only needed for write operations)
cat > .env << 'EOF'
# Required only for write operations (stake, unstake, wrap, unwrap, vote)
# Read-only tools (balances, rewards, position_summary) work without a key.
LIDO_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Network: "mainnet" (default) or "holesky" (testnet)
LIDO_NETWORK=mainnet

# RPC URL (optional — defaults to a public endpoint)
# LIDO_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
EOF

# 4. Test it works
npx tsx lido-mcp-server.ts
# Should print: "Lido MCP Server running on stdio (mainnet)"
# Press Ctrl+C to stop
```

#### Option B: From the full repo

```bash
cd yield-pilot
npm run mcp
```

#### Connect to Claude Desktop

Add this to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lido": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/lido-mcp-server.ts"],
      "env": {
        "LIDO_NETWORK": "mainnet",
        "LIDO_PRIVATE_KEY": "0xYOUR_KEY_HERE"
      }
    }
  }
}
```

> **Read-only mode**: Omit `LIDO_PRIVATE_KEY` entirely to use the server in read-only mode. Balance queries, protocol stats, and position summaries work without a wallet. Write operations (stake, wrap, vote) will return a clear error asking you to configure a key.

> **⚠️ nvm users**: Claude Desktop doesn't load your shell profile, so it picks up nvm's **default** Node version — which may be too old. If you see `Unexpected token {` errors, use the absolute path to a modern Node (v18+):
> ```json
> "command": "/Users/YOU/.nvm/versions/node/v22.9.0/bin/npx"
> ```
> Find your path with: `which npx` (after running `nvm use 22` in your terminal).

#### Connect to Claude Code

```bash
claude mcp add lido -- npx tsx /absolute/path/to/lido-mcp-server.ts
```

#### Connect to Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "lido": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/lido-mcp-server.ts"],
      "env": {
        "LIDO_NETWORK": "mainnet"
      }
    }
  }
}
```

#### Available Tools (9 total)

| Tool | Type | What it does |
|------|------|-------------|
| `lido_stake` | Write | Stake ETH → receive stETH (rebasing) |
| `lido_unstake` | Write | Request stETH withdrawal via Lido queue (1-5 days) |
| `lido_wrap` | Write | Wrap stETH → wstETH (non-rebasing, DeFi-safe) |
| `lido_unwrap` | Write | Unwrap wstETH → stETH |
| `lido_balances` | Read | ETH/stETH/wstETH/shares for any address |
| `lido_rewards` | Read | Protocol stats, exchange rate, withdrawal queue status |
| `lido_withdrawal_status` | Read | Check pending withdrawal request status |
| `lido_delegate_vote` | Write | LDO governance: delegate power, vote on proposals, list votes |
| `lido_position_summary` | Read | Full staking position with estimated daily/annual rewards |

All write tools support `dry_run: true` — always preview before executing.

#### Example Conversation

Once connected, you can talk to Claude naturally:

> **You**: What's the current Lido staking APR and how much stETH does vitalik.eth hold?
>
> **Claude**: *calls lido_rewards + lido_balances* — The current exchange rate is 1.2298 stETH/share, with ~9.19M ETH pooled. Estimated APR is 3-4.5%. Vitalik holds...
>
> **You**: Stake 0.5 ETH for me, but show me the preview first
>
> **Claude**: *calls lido_stake with dry_run: true* — Here's what would happen: you'd receive ~0.407 shares (0.5 stETH). Your wallet has 2.3 ETH, so you have sufficient balance. Shall I execute?

See `lido.skill.md` for the full agent mental model (rebasing mechanics, stETH vs wstETH, safe patterns).

## wstETH Support

The treasury supports both **stETH** (rebasing) and **wstETH** (non-rebasing wrapped stETH). This matters because many DeFi protocols and wallets handle wstETH better than stETH due to its non-rebasing nature.

**How it works:**

- **Deposit as wstETH**: Call `depositWstETH(amount)` — the contract unwraps wstETH → stETH internally and tracks it as principal. You approve wstETH spending to the treasury address first.
- **Withdraw as wstETH**: Call `withdrawPrincipalAsWstETH(stETHAmount)` — the contract wraps your stETH → wstETH before sending it back to you. Useful if you want to move funds into DeFi protocols that prefer wstETH.
- **Emergency withdraw**: Sends back both stETH and any residual wstETH balance to the owner.

The dashboard's **Treasury Management** panel includes a toggle to withdraw principal as wstETH directly from the UI.

**Contract addresses (Sepolia):**

| Token | Address |
|-------|---------|
| stETH | `0x6df25A1734E181AFbBD9c8A50b1D00e39D482704` |
| wstETH | `0xB82381A3fBD3FaFA77B3a7bE693342AA3d14232a` |

## Treasury Management UI

The dashboard includes a full **Treasury Management** panel (visible to the connected owner) with:

- **Withdraw Principal** — withdraw stETH or wstETH back to your wallet
- **Emergency Withdraw** — pull all funds instantly (with confirmation safeguard)
- **Daily Spend Limit** — adjust the max BPS the agent can spend per day (with presets: 10%, 25%, 50%, 75%)
- **Allowed Targets** — view, add, and remove addresses the agent can send yield to
- **Agent Control** — pause/resume agent operations
- **Transfer Ownership** — hand over treasury ownership to another address
- **Status Bar** — shows daily limit, remaining allowance, and pause state

Non-owners see a read-only view of the treasury state.

## Safety Guardrails

- **Principal protection**: Smart contract makes principal mathematically inaccessible to agent
- **Daily spend cap**: Configurable basis points limit on yield spending per day
- **Target whitelist**: Agent can only send yield to pre-approved addresses
- **Dry-run on all writes**: Every write operation supports simulation before execution
- **Multi-model risk check**: Dedicated risk model evaluates every action before execution
- **Compute budget**: USD-denominated daily cap on inference spending
- **Emergency pause**: Owner can freeze all agent operations instantly
- **Full audit trail**: Every cycle logged in structured agent_log.json

## Project Structure

```
yield-pilot/
├── contracts/
│   ├── YieldsPilotTreasury.sol      # Yield-separated treasury with wstETH support
│   ├── YieldsPilotRegistry.sol     # Multi-user factory (per-user treasuries)
│   └── mocks/
│       ├── MockStETH.sol           # Test mock for stETH rebasing
│       └── MockWstETH.sol          # Test mock for wstETH wrap/unwrap
├── test/
│   └── Treasury.test.ts            # 60 tests covering all safety invariants
├── scripts/
│   ├── deploy-sepolia.ts           # Hardhat deploy to Ethereum Sepolia
│   ├── deploy-registry.ts          # Deploy multi-user Registry factory
│   ├── deploy-status.ts            # Hardhat deploy to Status Network (gasless)
│   ├── deploy.sh                   # Unified deploy CLI (compile/test/deploy/verify)
│   ├── dev.sh                      # Local development runner
│   └── prod.sh                     # Docker Compose production wrapper
├── agent/
│   ├── index.ts                    # Main autonomous loop (Protocol Labs)
│   ├── services/
│   │   ├── venice.ts               # Private reasoning (Venice bounty)
│   │   ├── bankr.ts                # Multi-model analysis (Bankr bounty)
│   │   ├── uniswap.ts              # Real swap execution (Uniswap bounty)
│   │   ├── lido.ts                 # Lido staking operations
│   │   └── vaultMonitor.ts         # Vault monitor + Telegram (Lido bounty)
│   └── utils/
│       └── logger.ts               # Structured agent_log.json writer
├── mcp/
│   ├── lido-mcp-server.ts          # Lido MCP server (Lido $5K bounty)
│   └── lido.skill.md               # Lido agent guide (exposed via MCP resources)
├── frontend/                       # React + Vite + Tailwind dashboard
│   ├── src/
│   │   ├── App.tsx                 # Main layout
│   │   ├── components/             # StatCard, ReasoningPanel, ActivityFeed, TreasuryManagement, etc.
│   │   ├── hooks/                  # useAnimatedValue, useLiveYield
│   │   └── data/mock.ts            # Demo data
│   └── ...
├── config/
│   └── default.ts                  # Centralized configuration
├── types/
│   ├── index.ts                    # Shared TypeScript types
│   └── ambient.d.ts                # Module declarations
├── docker/
│   ├── agent.Dockerfile
│   ├── monitor.Dockerfile
│   ├── frontend.Dockerfile
│   └── nginx.conf
├── agent.json                      # ERC-8004 agent manifest
├── hardhat.config.ts               # Multi-chain Hardhat config
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Smart Contracts**: Solidity 0.8.24 + OpenZeppelin v5 + Hardhat
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Fonts**: Space Grotesk, JetBrains Mono, Inter
- **Runtime**: Node.js 18+ with tsx
- **Testing**: Hardhat + Chai + Mocha (60 tests)
- **Deployment**: Ethereum Sepolia (Treasury) + Base Mainnet (ERC-8004) + Status Sepolia (Gasless)

## Chains

| Chain | Purpose | Contract |
|-------|---------|----------|
| **Ethereum Sepolia** | Treasury + Lido + Uniswap | YieldsPilotTreasury |
| **Base Mainnet** | ERC-8004 agent identity | via synthesis.devfolio.co |
| **Status Sepolia** | Gasless bounty proof | YieldsPilotTreasury (copy) |

## License

MIT

---

Built for [Synthesis Hackathon](https://synthesis.md)
