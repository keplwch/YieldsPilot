# lido.skill.md — Lido Protocol Guide for AI Agents

## What is stETH?

stETH (staked ETH) is a **rebasing token** from Lido. When you stake ETH with Lido, you receive stETH 1:1. Your stETH balance **grows daily** as staking rewards are distributed — no claiming needed.

**Key insight for agents:** The balance in your wallet literally increases every day. If you hold 10 stETH today, tomorrow you might hold 10.001 stETH. This is how YieldPilot's treasury works — the principal stays fixed, and the balance growth IS the yield.

## stETH vs wstETH

| Property | stETH | wstETH |
|----------|-------|--------|
| Balance changes? | Yes (rebases daily) | No (fixed balance) |
| Value changes? | Stays ~1:1 with ETH | Increases vs stETH over time |
| Better for | Holding, tracking rewards | DeFi (Uniswap, Aave, etc.) |
| Wrapping | Base form | Wrapped version of stETH |

**When to use which:**
- **stETH** for treasury principal tracking (rebasing = visible yield)
- **wstETH** for DeFi integrations (non-rebasing = no accounting issues)

## Safe Patterns for Agents

### DO:
- Always use `dry_run: true` before any write operation
- Check `availableYield()` before spending — never assume
- Respect the daily spend limit (`maxDailySpendBps`)
- Wrap stETH → wstETH before sending to DeFi protocols
- Monitor the stETH/ETH exchange rate for depegging risk
- Log every action with reason strings for onchain auditability

### DON'T:
- Never try to spend more than `availableYield()` returns
- Never approve unlimited allowances — use exact amounts
- Don't assume 1 stETH = 1 ETH (there can be a discount)
- Don't unstake for small amounts (gas > value)
- Don't make rapid successive transactions (batch if possible)

## Rebasing Explained

Every ~24 hours, Lido's oracle reports new validator rewards. The stETH contract then adjusts ALL holder balances proportionally.

```
Before rebase: You hold 10.000000 stETH
Oracle reports: +0.01% daily reward
After rebase:  You hold 10.001000 stETH
```

This is invisible — no transaction occurs. Your balance just changes. This is why the YieldPilot treasury compares current `balanceOf(treasury)` against the stored `principal` to calculate yield.

## Current APR

Lido staking APR fluctuates between ~3-5% annually. Check real-time:
- https://lido.fi/ethereum — official dashboard
- `getProtocolStats()` in the Lido MCP for programmatic access

## MCP Tools Available

This project includes a full Lido MCP server with these tools:

1. `lido_stake` — Stake ETH → stETH
2. `lido_unstake` — Request withdrawal (1-5 day queue)
3. `lido_wrap` — stETH → wstETH
4. `lido_unwrap` — wstETH → stETH
5. `lido_balances` — Query all balances + treasury state
6. `lido_rewards` — Protocol stats and APR
7. `lido_spend_yield` — Agent spends available yield
8. `lido_vault_health` — Treasury health check
9. `lido_delegate_vote` — Governance delegation

All write operations support `dry_run: true` for safe preview.
