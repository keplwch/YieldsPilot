# YieldPilot — Claude Code Context

## Project Overview

**YieldPilot** is an autonomous DeFi agent that accepts ETH deposits, stakes via Lido to earn stETH yield, and uses multi-model AI to manage that yield on-chain — while mathematically locking the original principal in a smart contract.

Key architectural guarantee: the agent can only spend yield, never principal.

---

## Commands

### Package Manager
Use **bun** for all installations.

```bash
bun install                        # Root dependencies
cd frontend && bun install         # Frontend dependencies
```

### Development
```bash
./scripts/dev.sh start             # All services (frontend + agent + monitor)
./scripts/dev.sh frontend          # Dashboard only → http://localhost:5173
./scripts/dev.sh agent             # Autonomous loop only
./scripts/dev.sh monitor           # Vault monitor only
./scripts/dev.sh logs              # Tail all service logs
./scripts/dev.sh stop              # Stop all services
```

### Smart Contracts
```bash
npm run compile                    # Hardhat compile
npm run test                       # 25 contract tests (Hardhat + Chai)
./scripts/deploy.sh sepolia        # Deploy to Ethereum Sepolia
./scripts/deploy.sh all            # Deploy to all configured networks
```

### API & MCP
```bash
npm run api                        # Express API server → port 3001
npm run mcp                        # Lido MCP server (9 tools)
```

### Production
```bash
./scripts/prod.sh up               # Docker: agent + monitor + frontend
./scripts/prod.sh logs             # View prod logs
./scripts/prod.sh stop             # Stop all containers
```

---

## Codebase Navigation

### Directory Map & What to Find Where

#### `contracts/` — Solidity Smart Contracts
The on-chain layer. Start here when touching treasury logic, principal protection, or spend limits.
- `YieldPilotTreasury.sol` — Core single-user treasury. Look here for: principal tracking, `maxDailySpendBps`, `allowedTargets` whitelist, events (`Deposited`, `YieldSpent`, `PrincipalWithdrawn`)
- `YieldPilotRegistry.sol` — Multi-user factory. Look here for: per-user treasury deployment, registry lookup
- `mocks/MockStETH.sol` — Test-only stETH mock with simulated rebasing. Only relevant for `test/`

#### `agent/` — Autonomous Agent Loop
The AI decision engine. Start here when touching LLM calls, on-chain execution logic, or the agent cycle.
- `index.ts` — Entry point for the autonomous loop. Contains the 4-phase cycle (DISCOVER → PLAN → EXECUTE → VERIFY), cycle interval, and per-user iteration logic
- `services/venice.ts` — Venice AI call (private reasoning). Look here for: system prompt, decision schema, confidence/risk extraction
- `services/bankr.ts` — Bankr multi-model gateway. Look here for: parallel risk/market/strategy calls, model selection, response merging
- `services/uniswap.ts` — Swap execution. Look here for: quote generation, dry-run toggle, live swap with txHash
- `services/lido.ts` — Lido staking operations. Look here for: ETH→stETH stake, withdrawal requests, wstETH wrapping, balance queries
- `services/vaultMonitor.ts` — Polling + Telegram alerts. Look here for: yield delta calculation, alert thresholds, notification format
- `utils/logger.ts` — ERC-8004 structured logger. Look here for: `agent_log.json` schema, phase/action/txHash fields

#### `api/` — Express REST API (port 3001)
The bridge between the frontend and on-chain/agent data. Start here when adding new dashboard endpoints or changing what the frontend polls.

#### `mcp/` — Model Context Protocol Server
Exposes Lido operations as MCP tools (9 tools). Relevant only when working on MCP integrations or the `lido.skill.md` agent capability.

#### `frontend/` — React Dashboard
The monitoring UI. Start here for all visual/UX work.
- `src/index.css` — **Design system source of truth.** All CSS variables, utility classes, animations, notch card pattern, atmospheric effects
- `src/App.tsx` — Root layout and grid. Start here to understand the dashboard's overall structure
- `src/components/` — All UI components (see component guide in Design System section below)
- `src/hooks/useApi.ts` — API polling with demo-mode fallback. Look here when data isn't loading or you need to add a new data fetch
- `src/hooks/useAnimatedValue.ts` — Smooth number transitions. Use this for any animated numeric display
- `src/providers/WalletProvider.tsx` — RainbowKit + Wagmi setup. Look here for wallet chain config, RPC settings
- `src/data/mock.ts` — Demo data. Edit this when the API is down or for visual development without a live backend
- `frontend/tailwind.config.js` — Custom Tailwind tokens (`accent-purple`, `accent-green`, etc.). Add new tokens here, never use raw hex in JSX

#### `config/default.ts` — Centralized Configuration
Single source of truth for: LLM model names, agent loop interval, gas limits, contract addresses, Lido endpoints, compute budget. **Change model names or timing here, not in individual service files.**

#### `types/` — Shared TypeScript Types
- `index.ts` — All shared interfaces (treasury state, agent action, log entry, etc.). Check here before defining new types elsewhere.
- `ambient.d.ts` — Module declarations for untyped packages

#### `scripts/` — Operational Scripts
- `dev.sh` — Local development process manager (wraps individual service starts)
- `prod.sh` — Docker Compose wrapper for production
- `deploy.sh` — Hardhat deploy runner for Sepolia / all networks
- `deploy-sepolia.ts`, `deploy-registry.ts`, `deploy-status.ts` — Individual deploy scripts called by `deploy.sh`

#### `test/` — Contract Tests
Hardhat + Chai tests for all contract behaviour. 25 tests covering treasury invariants, registry, and mock stETH. Run with `npm run test`.

#### `typechain-types/` — Generated Contract ABIs
Auto-generated by Hardhat TypeChain. **Never edit manually.** Regenerate with `npm run compile` after any `.sol` change.

#### `docker/` — Production Container Config
Nginx config + Dockerfiles for agent, frontend, and monitor services.

---

### Quick Navigation Reference

| I want to change… | Go to |
|---|---|
| How the agent makes decisions | `agent/index.ts` + `agent/services/venice.ts` |
| Which LLM models are used | `config/default.ts` |
| Treasury principal/yield logic | `contracts/YieldPilotTreasury.sol` |
| A swap or Lido operation | `agent/services/uniswap.ts` or `agent/services/lido.ts` |
| Dashboard layout or new page | `frontend/src/App.tsx` |
| An existing UI component | `frontend/src/components/<ComponentName>.tsx` |
| Colors, fonts, card styles | `frontend/src/index.css` |
| Tailwind utility tokens | `frontend/tailwind.config.js` |
| API endpoint (backend) | `api/` |
| What the frontend fetches | `frontend/src/hooks/useApi.ts` |
| Telegram alert logic | `agent/services/vaultMonitor.ts` |
| Shared TypeScript types | `types/index.ts` |
| ERC-8004 log format | `agent/utils/logger.ts` |
| Demo/mock data | `frontend/src/data/mock.ts` |

---

### Agent Loop (agent/index.ts)
4-phase cycle runs every 60s per treasury:
1. **DISCOVER** — Query treasury balances + available yield
2. **PLAN** — Venice AI (private reasoning) + Bankr (3 LLMs: risk/market/strategy)
3. **EXECUTE** — Swap via Uniswap, stake/unstake via Lido, or hold
4. **VERIFY** — Confirm on-chain state matches intent; log to `agent_log.json` (ERC-8004)

### Smart Contracts
- `YieldPilotTreasury.sol` — Single-user treasury. Tracks `principal` (locked) and `yieldWithdrawn`. Enforces `maxDailySpendBps`.
- `YieldPilotRegistry.sol` — Factory: each user gets their own treasury instance.

---

## Environment Variables

Copy `.env.example` to `.env`. Critical vars:

```bash
AGENT_PRIVATE_KEY=          # Testnet agent wallet key
RPC_URL=                    # Ethereum Sepolia RPC
VENICE_API_KEY=             # Venice AI (private reasoning)
BANKR_API_KEY=              # Bankr multi-model gateway
UNISWAP_API_KEY=            # Uniswap Trading API
TREASURY_CONTRACT=          # Deployed treasury address
REGISTRY_CONTRACT=          # Deployed registry address
TELEGRAM_BOT_TOKEN=         # Optional: alert bot
TELEGRAM_CHAT_ID=           # Optional: alert chat
```

---

## Frontend Design System

The dashboard has a strong, deliberate aesthetic. **Do not deviate from it.**

### Typography
| Role | Font | Notes |
|------|------|-------|
| Display / headings | `Syne` | Bold, geometric — used for titles, stat values |
| Body / UI text | `DM Sans` | Clean sans-serif |
| Monospace / values | `JetBrains Mono` | Numbers, terminal output, labels |

### Color Palette
```css
/* Backgrounds */
--bg-primary:   #020208    /* page background */
--bg-secondary: #07071a    /* sections */
--bg-card:      #0c0c1f    /* card surfaces */

/* Accent colors */
--accent-purple: #6366f1   /* primary accent — borders, highlights */
--accent-green:  #00e5a0   /* yield / positive values */
--accent-blue:   #06b6d4   /* info / secondary accent */
--accent-orange: #f59e0b   /* warning / caution */
--accent-red:    #f43f5e   /* error / danger / negative */

/* Text */
--text-primary:   #e2e8f0  /* main readable text */
--text-secondary: #94a3b8  /* supporting text */
--text-muted:     #475569  /* disabled / faint labels */

/* Borders */
--border-subtle: rgba(99,102,241,0.12)   /* default card borders */
--border-active: rgba(99,102,241,0.38)   /* hover / focused state */
```

### Layout & Component Patterns
- **Diagonal notch cards**: Cards use a clipped top-right corner (14px diagonal). Two-layer: `.card-wrap` (1px border) + `.card-body` (content). Hover increases border brightness.
- **Stat cards**: Dual-corner notch (top-left + bottom-right). Slide-in animation with staggered `animation-delay`. Optional badge row (green/red).
- **Atmospheric background**: Dot grid (radial gradient, 28px spacing) + 3 fixed glows — indigo (top-center), emerald (bottom-right), cyan (top-left).
- **Scrollbars**: Custom thin scrollbar in `--accent-purple`.

### Animation Classes
- `pulse-glow` — 2s pulsing shadow (live indicators)
- `slide-in` — entry animation for cards
- `fade-in` — opacity transition
- `shimmer` — loading skeleton
- `float` — subtle vertical bobbing

### Key Components
- `ReasoningPanel` — Terminal-style output, line-by-line animated reveal (350ms/line), "Venice • Private" badge
- `ActivityFeed` — Phase-colored badges: discover=blue, plan=purple, execute=green, verify=orange, alert=red
- `TreasuryRing` — SVG donut chart. Outer ring = principal (purple), inner ring = yield (green)
- `YieldChart` — 14-bar history. Progressive purple gradient, latest bar glows
- `StatCard` — 10px mono label → 28px display value (tabular-nums) → 11px mono subtitle

### Design Rules for New UI Work
1. **Dark-only.** Never introduce light mode or light backgrounds.
2. **Purple is the primary accent.** Green is strictly for yield/positive values.
3. **Use `Syne` for any new headings or large values.** Never use Inter, Roboto, or system fonts.
4. **Cards must use the notch pattern.** Flat rectangular cards are off-brand.
5. **Animations should be purposeful.** Entry animations (slide-in/fade-in) and live indicators (pulse-glow) are correct uses. Avoid gratuitous motion.
6. **Borders at 1px.** Always `rgba(99,102,241,0.12)` default, `rgba(99,102,241,0.38)` on hover/active.
7. **Values in JetBrains Mono with tabular-nums.** All ETH amounts, percentages, and financial figures.

---

## Key Patterns & Gotchas

- **Principal is always protected.** The `principal` value in the treasury is locked by the contract — agent code must never attempt to spend it. Available yield = `currentBalance - principal`.
- **Venice AI is private.** Calls to Venice use `noSystemPrompt: true` and `noLogs: true` — never log Venice responses externally.
- **Bankr uses 3 separate model calls.** Risk → `gpt-5-mini`, Market → `claude-haiku-4.5`, Strategy → `gemini-3-flash`. These run in parallel.
- **Agent log is ERC-8004 structured.** `agent_log.json` must maintain the phase/action/reasoning/txHash schema. Don't break the structure.
- **Frontend uses demo mode fallback.** If the API is unreachable, `useApi.ts` falls back to `data/mock.ts`. `ConnectionBanner.tsx` shows a warning.
- **Vite proxies `/api` → port 3001.** Don't hardcode API URLs in frontend components.
- **TypeChain types are generated.** Run `npm run compile` before editing contract interaction code — `typechain-types/` must be current.
- **Tailwind config has custom tokens.** Always use the custom color tokens (`accent-purple`, `accent-green`, etc.) — don't inline arbitrary hex values in components.
