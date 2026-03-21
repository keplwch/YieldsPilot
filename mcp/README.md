# Lido MCP Server: Reference MCP Server for the Lido Staking Protocol

A standalone, general-purpose MCP (Model Context Protocol) server that lets any AI agent interact with Lido's staking protocol on Ethereum. Point Claude Desktop, Cursor, Claude Code, or any MCP-compatible client at this server and stake ETH, check balances, wrap/unwrap tokens, and vote on governance, all from natural language conversation.

**No custom integration code needed.** One config line, and your AI can talk to Lido.

---

## Demo

> 📹 **[Watch MCP Demo on YouTube](https://youtu.be/4Mxcwr_oTcI)**
>
> Standalone Lido MCP server in action: Claude Desktop integration → query staking positions → check balances → stake ETH → wrap/unwrap stETH ↔ wstETH → governance delegation, all via natural language

---

## What Can You Do With It

### For End Users
- **"How much stETH do I hold?"**: Check your full staking position (ETH, stETH, wstETH, shares) with a single question
- **"Stake 1 ETH for me"**: Stake ETH via Lido and receive stETH, with dry-run preview before execution
- **"What's the current staking APR?"**: Get live protocol stats, exchange rates, and withdrawal queue status
- **"Wrap my stETH to wstETH"**: Convert between stETH and wstETH for DeFi compatibility
- **"Show me my estimated annual rewards"**: Full position summary with daily/monthly/annual yield projections
- **"Delegate my LDO voting power to vitalik.eth"**: Participate in Lido governance without leaving your chat

### For Developers & Agent Builders
- **Drop-in Lido integration** for any MCP-compatible agent, no SDK, no custom code
- **Read-only mode** works with zero configuration (no wallet key needed)
- **Dry-run support** on all write operations: agents can preview before executing
- **Embedded knowledge** via `lido.skill.md` resource: your agent automatically understands stETH rebasing mechanics, wstETH wrapping, withdrawal queue timing, and safe interaction patterns
- **Network switching**: mainnet or Holesky testnet via a single env var
- **Composable**: combine with other MCP servers (Uniswap, Aave, etc.) for multi-protocol agent workflows

### For the Lido Ecosystem
- **Reference implementation** that other teams can fork and extend
- **Governance accessibility**: makes DAO voting available to non-technical LDO holders via conversational AI
- **Protocol education**: the embedded `lido.skill.md` teaches agents (and users) about stETH rebasing, share mechanics, and safe patterns

---

## Quick Start

### Option A: Standalone (no full repo needed)

```bash
# 1. Create a folder and install dependencies
mkdir lido-mcp && cd lido-mcp
npm init -y
npm install @modelcontextprotocol/sdk ethers dotenv tsx

# 2. Download the two files
curl -O https://raw.githubusercontent.com/keplwch/yield-pilot/main/mcp/lido-mcp-server.ts
curl -O https://raw.githubusercontent.com/keplwch/yield-pilot/main/mcp/lido.skill.md

# 3. Create a .env (optional, only needed for write operations)
cat > .env << 'EOF'
# Required only for write operations (stake, unstake, wrap, unwrap, vote)
# Read-only tools (balances, rewards, position_summary) work without a key.
LIDO_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Network: "mainnet" (default) or "holesky" (testnet)
LIDO_NETWORK=mainnet

# RPC URL (optional, defaults to a public endpoint)
# LIDO_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
EOF

# 4. Test it works
npx tsx lido-mcp-server.ts
# Should print: "Lido MCP Server running on stdio (mainnet)"
# Press Ctrl+C to stop
```

### Option B: From the full YieldsPilot repo

```bash
cd yield-pilot
npm run mcp
```

---

## Connect to Your AI Client

### Claude Desktop

Add to your config file:

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

> **Read-only mode**: Omit `LIDO_PRIVATE_KEY` entirely. Balance queries, protocol stats, and position summaries work without a wallet. Write operations will return a clear error asking you to configure a key.

> **nvm users**: Claude Desktop doesn't load your shell profile, so it picks up nvm's **default** Node version, which may be too old. If you see `Unexpected token {` errors, use the absolute path to a modern Node (v18+):
> ```json
> "command": "/Users/YOU/.nvm/versions/node/v22.9.0/bin/npx"
> ```
> Find your path with: `which npx` (after running `nvm use 22`).

### Claude Code

```bash
claude mcp add lido -- npx tsx /absolute/path/to/lido-mcp-server.ts
```

### Cursor

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

### Any MCP-Compatible Client

The server uses **stdio transport**: any client that speaks MCP over stdin/stdout can connect. Launch with:

```bash
npx tsx /path/to/lido-mcp-server.ts
```

---

## Available Tools (9 total)

| Tool | Type | What it does |
|------|------|-------------|
| `lido_stake` | Write | Stake ETH → receive stETH (rebasing). Calls Lido's `submit()` function. |
| `lido_unstake` | Write | Request stETH withdrawal via Lido's Withdrawal Queue. Returns an NFT claim ticket (1-5 day wait). |
| `lido_wrap` | Write | Wrap stETH → wstETH (non-rebasing). Essential before using stETH in DeFi protocols. |
| `lido_unwrap` | Write | Unwrap wstETH → stETH. Converts back to the rebasing form. |
| `lido_balances` | Read | Query ETH, stETH, wstETH balances and share count for any address or ENS name. |
| `lido_rewards` | Read | Protocol stats: total pooled ETH, share exchange rate, withdrawal queue status, estimated APR. |
| `lido_withdrawal_status` | Read | Check status of pending withdrawal NFTs: finalized, claimable, or still waiting. |
| `lido_delegate_vote` | Write | LDO governance: delegate voting power, cast votes on Aragon proposals, list active votes. |
| `lido_position_summary` | Read | Full staking position analysis with estimated daily, monthly, and annual rewards. |

**All write tools support `dry_run: true`**: the agent can preview every transaction before executing. This is critical for safe autonomous operation.

---

## Embedded Resources

The server exposes two MCP resources that agents can read for context:

| Resource | Description |
|----------|-------------|
| `lido://skill` | The full `lido.skill.md`: teaches the agent about stETH rebasing, wstETH wrapping, withdrawal queue mechanics, governance, safe patterns, and common pitfalls |
| `lido://addresses` | Current contract addresses for the active network (stETH, wstETH, Withdrawal Queue, LDO, Aragon Voting) |

When an agent reads `lido://skill` before interacting, it understands why stETH balances change daily, when to use wstETH vs stETH, and how the withdrawal queue works, without you having to explain any of it.

---

## Example Conversations

### Checking a Position

> **You**: What's the current Lido staking APR and how much stETH does vitalik.eth hold?
>
> **Claude**: *calls lido_rewards + lido_balances* The current exchange rate is 1.2298 stETH/share, with ~9.19M ETH pooled. Estimated APR is 3-4.5%. vitalik.eth holds 1,024.37 stETH (~$3.7M at current prices).

### Staking with Preview

> **You**: Stake 0.5 ETH for me, but show me the preview first
>
> **Claude**: *calls lido_stake with dry_run: true* Here's what would happen: you'd send 0.5 ETH to Lido's staking contract and receive ~0.407 shares (displayed as 0.5 stETH in your wallet). Your wallet has 2.3 ETH, so you have sufficient balance. Shall I execute?
>
> **You**: Yes, go ahead
>
> **Claude**: *calls lido_stake with dry_run: false* Done! Transaction confirmed: 0x3f8a... You now hold 0.5 stETH. Your balance will increase slightly every day as staking rewards accrue.

### Wrapping for DeFi

> **You**: I want to use my stETH in Aave. What should I do?
>
> **Claude**: Aave works better with wstETH (the non-rebasing version) since stETH's daily rebasing can confuse some DeFi protocols. Let me wrap your stETH first.
>
> *calls lido_wrap with dry_run: true* I can wrap your 10 stETH into ~8.13 wstETH. The value is identical: wstETH just doesn't rebase, so the number stays fixed while each token becomes worth more stETH over time. Want me to proceed?

### Governance

> **You**: Delegate my LDO voting power to 0xABC...
>
> **Claude**: *calls lido_delegate_vote* Done! Your LDO voting power is now delegated to 0xABC... They can vote on your behalf in Lido DAO proposals. Your LDO tokens remain in your wallet; only the voting power is delegated.

---

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `LIDO_NETWORK` | No | `mainnet` | Network to connect to: `mainnet` or `holesky` |
| `LIDO_PRIVATE_KEY` | For writes | (none) | Private key for signing transactions. Omit for read-only mode. |
| `LIDO_RPC_URL` | No | Public endpoint | Custom RPC URL. Falls back to `RPC_URL` env var, then to a public endpoint. |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│          AI Client (Claude, Cursor, etc.)     │
│  "Stake 0.5 ETH"  →  calls lido_stake tool   │
└────────────────────────┬─────────────────────┘
                         │ MCP (stdio)
                         ▼
┌──────────────────────────────────────────────┐
│            lido-mcp-server.ts                │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 5 Write  │  │ 4 Read   │  │ Resources │  │
│  │ Tools    │  │ Tools    │  │ skill.md  │  │
│  └────┬─────┘  └────┬─────┘  └───────────┘  │
│       │              │                       │
│       ▼              ▼                       │
│  ┌──────────────────────────────────┐        │
│  │  ethers.js  (Provider + Wallet)  │        │
│  └────────────────┬─────────────────┘        │
└───────────────────┼──────────────────────────┘
                    │ JSON-RPC
                    ▼
┌──────────────────────────────────────────────┐
│         Ethereum (Mainnet / Holesky)         │
│  stETH  │  wstETH  │  Withdrawal Queue       │
│  LDO    │  Aragon Voting                      │
└──────────────────────────────────────────────┘
```

---

## Files

| File | Description |
|------|-------------|
| `lido-mcp-server.ts` | The MCP server, single file, ~400 lines, zero external dependencies beyond ethers + MCP SDK |
| `lido.skill.md` | Agent mental model: rebasing mechanics, stETH vs wstETH, withdrawal queue, governance, safe patterns. Exposed as an MCP resource so agents can read it for context. |

---

## Contract Addresses

### Ethereum Mainnet

| Contract | Address |
|----------|---------|
| stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |
| wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| Withdrawal Queue | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` |
| LDO Token | `0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32` |
| Aragon Voting | `0x2e59A20f205bB85a89C53f1936454680651E618e` |

### Holesky Testnet

| Contract | Address |
|----------|---------|
| stETH | `0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034` |
| wstETH | `0x8d09a4502Cc8Cf1547aD300E066060D043f6982D` |
| Withdrawal Queue | `0xc7cc160b58F8Bb0baC94b80847E2CF2800565C50` |

---

## How It Fits Into YieldsPilot

This MCP server is one component of the larger [YieldsPilot](../README.md) project, an autonomous DeFi agent that manages staking yield with privacy-preserving reasoning. Within YieldsPilot, the MCP server serves as the Lido interaction layer, but it's designed to be **fully standalone**: you can use it for general lido related action and not directly related to the project YieldPilot.

The YieldsPilot agent uses the same Lido operations internally (via `agent/services/lido.ts`), but the MCP server makes these capabilities available to **any** MCP-compatible AI client without writing code.

---

## License

MIT
