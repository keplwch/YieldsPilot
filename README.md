# YieldPilot — Autonomous DeFi Agent with Privacy-Preserving Yield Management

> **Private cognition. Trusted onchain action.**

YieldPilot is an autonomous AI agent that manages staking yield on behalf of a user. You deposit ETH, it earns yield via Lido stETH, the agent privately reasons about how to manage that yield (swap, rebalance, compound), and every action is executed and verified onchain. **The agent can never touch your principal.**

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    HUMAN (You)                          │
│   Deposit 32 ETH → stETH → YieldPilot Treasury         │
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

### 6. Use Lido MCP

```bash
npm run mcp
# Exposes 9 tools via MCP stdio transport:
#   lido_stake, lido_unstake, lido_wrap, lido_unwrap,
#   lido_balances, lido_rewards, lido_spend_yield,
#   lido_vault_health, lido_delegate_vote
```

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
│   ├── YieldPilotTreasury.sol      # Yield-separated treasury (Lido bounty)
│   └── mocks/
│       └── MockStETH.sol           # Test mock for stETH rebasing
├── test/
│   └── Treasury.test.ts            # 25 tests covering all safety invariants
├── scripts/
│   ├── deploy-sepolia.ts           # Hardhat deploy to Ethereum Sepolia
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
│   └── lido-mcp-server.ts          # Lido MCP server (Lido $5K bounty)
├── frontend/                       # React + Vite + Tailwind dashboard
│   ├── src/
│   │   ├── App.tsx                 # Main layout
│   │   ├── components/             # StatCard, ReasoningPanel, ActivityFeed, etc.
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
├── lido.skill.md                   # Lido guide for AI agents
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
- **Testing**: Hardhat + Chai + Mocha (25 tests)
- **Deployment**: Ethereum Sepolia (Treasury) + Base Mainnet (ERC-8004) + Status Sepolia (Gasless)

## Chains

| Chain | Purpose | Contract |
|-------|---------|----------|
| **Ethereum Sepolia** | Treasury + Lido + Uniswap | YieldPilotTreasury |
| **Base Mainnet** | ERC-8004 agent identity | via synthesis.devfolio.co |
| **Status Sepolia** | Gasless bounty proof | YieldPilotTreasury (copy) |

## License

MIT

---

Built for [Synthesis Hackathon](https://synthesis.md)
