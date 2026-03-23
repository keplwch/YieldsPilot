# AGENTS.md

> Machine-readable project context for agentic judges and AI coding agents.

## Project overview

YieldsPilot is an autonomous DeFi agent that manages Lido staking yield. Users deposit stETH into a yield-separated treasury contract. The agent reasons privately (Venice), validates across multiple LLMs (Bankr), executes swaps (Uniswap Trading API v1 + Permit2), and logs every cycle (ERC-8004). The agent can only spend yield, never principal.

**Identity:** `did:synthesis:34520`
**Registry contract:** [`0x6df25A1734E181AFbBD9c8A50b1D00e39D482704`](https://etherscan.io/address/0x6df25A1734E181AFbBD9c8A50b1D00e39D482704)
**Live app:** [yieldspilot.com](https://yieldspilot.com)

## Architecture

```
User deposits stETH/wstETH
        │
        ▼
┌─ YieldsPilotTreasury (Solidity) ─────────────────────┐
│  principal: LOCKED (share accounting)                 │
│  yield: AGENT-MANAGED (daily BPS cap)                 │
│  swapYield(): approve → Permit2 → router → verify    │
└───────────────────────┬───────────────────────────────┘
                        │
        ┌───────────────┼───────────────────┐
        ▼               ▼                   ▼
   Venice AI        Bankr Gateway      Uniswap API v1
   (private         (multi-model)      (swap execution)
    reasoning)      GPT-5-mini         /quote → /swap
   llama-3.3-70b   Claude Haiku 4.5   Permit2 flow
   no retention    Gemini 3 Flash      V2 + V3 routing
```

## Agent loop

The autonomous loop runs every 5 minutes (configurable via `AGENT_INTERVAL_MS`):

1. **DISCOVER** — Fetch treasury balances, yield, protocol stats, and live market data (CoinGecko prices, gas costs, DeFiLlama pool TVL) in parallel
2. **PLAN** — Venice private reasoning (swap or hold?) + Bankr multi-model validation (risk, market, strategy)
3. **EXECUTE** — Build Uniswap swap calldata via Trading API v1, submit `treasury.swapYield()` onchain with Permit2
4. **VERIFY** — Confirm onchain state matches intent, log cycle to `agent_log.json` with DID stamp

## Setup commands

```bash
# Install dependencies
bun install
cd frontend && bun install && cd ..

# Copy and configure environment
cp .env.example .env

# Compile contracts
npx hardhat compile

# Run unit tests (60 tests)
npx hardhat test

# Run mainnet fork tests (4 tests)
FORK_RPC=$RPC_URL ./scripts/deploy.sh fork:test

# Deploy to Sepolia
./scripts/deploy.sh sepolia

# Deploy to mainnet
./scripts/deploy.sh mainnet

# Start all services
./scripts/dev.sh start

# Start individually
bun run agent      # Autonomous agent loop
bun run monitor    # Vault monitor + Telegram alerts
bun run mcp        # Lido MCP server
bun run api        # REST API server
cd frontend && bun dev   # Dashboard on :5173
```

## Code style

- TypeScript strict mode throughout
- Solidity 0.8.24 with OpenZeppelin v5
- No semicolons omitted (always use semicolons)
- Double quotes for strings
- Explicit return types on all exported functions
- `const` by default, `let` only when mutation is needed
- Structured JSON logging (no unstructured console.log in production paths)

## Key files

| File | Purpose |
|---|---|
| `contracts/YieldsPilotTreasury.sol` | Yield-separated treasury with Permit2 support, principal lock, daily spend caps |
| `contracts/YieldsPilotRegistry.sol` | Multi-user factory that creates per-user treasury instances |
| `agent/index.ts` | Main autonomous loop (discover → plan → execute → verify) |
| `agent/services/venice.ts` | Private reasoning via Venice (no data retention, llama-3.3-70b) |
| `agent/services/bankr.ts` | Multi-model analysis: risk (gpt-5-mini), market (claude-haiku-4.5), strategy (gemini-3-flash) |
| `agent/services/uniswap.ts` | Uniswap Trading API v1 integration: /quote, /swap, buildContractSwap() |
| `agent/services/lido.ts` | Lido protocol ops: stake, unstake, wrap, unwrap, balances, exchange rates |
| `agent/services/marketData.ts` | Real-time market data: CoinGecko prices, RPC gas, DeFiLlama pool TVL |
| `agent/services/vaultMonitor.ts` | Vault position monitor with Telegram alerts |
| `agent/utils/logger.ts` | ERC-8004 structured logger (agent_log.json with DID stamps) |
| `mcp/lido-mcp-server.ts` | Standalone Lido MCP server (9 tools, independent of YieldsPilot) |
| `config/default.ts` | Centralized configuration (all env vars, model names, contract addresses) |
| `agent.json` | ERC-8004 agent manifest |
| `frontend/src/App.tsx` | React dashboard entry point |

## External services

| Service | Purpose | Auth |
|---|---|---|
| Venice AI (`api.venice.ai`) | Private LLM reasoning (no data retention) | `VENICE_API_KEY` |
| Bankr Gateway (`llm.bankr.bot`) | Multi-model LLM gateway (20+ models) | `BANKR_API_KEY` |
| Uniswap Trading API (`trade-api.gateway.uniswap.org/v1`) | Swap quotes and execution calldata | `UNISWAP_API_KEY` |
| CoinGecko API | ETH/stETH price data | None (public) |
| DeFiLlama Yields API | Uniswap pool TVL and volume | None (public) |
| Ethereum RPC | Onchain reads/writes | `RPC_URL` |
| Telegram Bot API | Vault monitoring alerts | `TELEGRAM_BOT_TOKEN` |

## Smart contract interface

The treasury contract exposes these key functions:

```solidity
// Agent calls (only callable by authorized agent wallet)
function swapYield(address router, uint256 amountIn, bytes calldata swapCalldata, address tokenOut, uint256 minAmountOut) external
function spendYield(address target, uint256 amount) external

// Owner calls
function deposit(uint256 amount) external
function depositWstETH(uint256 wstETHAmount) external
function withdrawPrincipal(uint256 amount) external
function emergencyWithdraw() external
function setMaxDailySpendBps(uint256 newBps) external
function setAllowedTarget(address target, bool allowed) external
function pause() / unpause() external
function setAgent(address newAgent) external

// View functions
function availableYield() external view returns (uint256)
function dailySpendRemaining() external view returns (uint256)
function principal() external view returns (uint256)
```

## MCP server (Lido)

The Lido MCP server is a standalone tool, independent of YieldsPilot. It provides 9 tools for any AI agent to interact with the Lido protocol:

| Tool | Type | Description |
|---|---|---|
| `lido_stake` | Write | Stake ETH to receive stETH |
| `lido_unstake` | Write | Request stETH withdrawal via Lido queue |
| `lido_wrap` | Write | Wrap stETH to wstETH |
| `lido_unwrap` | Write | Unwrap wstETH to stETH |
| `lido_balances` | Read | Query ETH/stETH/wstETH/shares for any address |
| `lido_rewards` | Read | Protocol stats, APR, exchange rate |
| `lido_withdrawal_status` | Read | Check pending withdrawal requests |
| `lido_delegate_vote` | Write | LDO governance: delegate, vote, list proposals |
| `lido_position_summary` | Read | Full position with estimated daily/annual rewards |

All write tools support `dry_run: true` for preview before execution.

Connect via stdio transport:
```bash
bun run mcp
```

## Safety constraints

- **Principal lock**: Treasury contract mathematically prevents agent from accessing deposited principal
- **Daily spend cap**: Configurable BPS limit on yield spending per 24h window
- **Allowed targets**: Whitelist of addresses the agent can send yield to
- **Permit2 reset**: All token approvals (direct + Permit2) reset to zero after each swap
- **Risk assessment**: Bankr risk model evaluates every action before execution
- **Pause mechanism**: Owner can freeze all agent operations instantly
- **Emergency withdraw**: Owner can recover 100% of funds at any time
- **Agent key compromise**: Attacker limited to daily yield cap, whitelisted targets only

## Testing

```bash
# Unit tests (60 tests) — Hardhat local network with mocks
npx hardhat test

# Mainnet fork tests (4 tests) — real Lido + Uniswap contracts
FORK_RPC=$RPC_URL ./scripts/deploy.sh fork:test

# Type checking
npx tsc --noEmit
```

## Environment variables

See `.env.example` for the full list. Required keys:
- `VENICE_API_KEY` — Venice AI inference
- `BANKR_API_KEY` — Bankr multi-model gateway
- `UNISWAP_API_KEY` — Uniswap Trading API
- `AGENT_PRIVATE_KEY` — Agent wallet (signs transactions)
- `RPC_URL` — Ethereum RPC endpoint (Alchemy/Infura)
- `REGISTRY_CONTRACT` — Deployed registry address
