# lido.skill.md — Lido Protocol Mental Model for AI Agents

Read this before calling any Lido MCP tool. It will save you from common mistakes.

## What is Lido?

Lido is a liquid staking protocol for Ethereum. You deposit ETH, receive stETH, and earn ~3-5% APR from Ethereum's proof-of-stake consensus rewards — without running your own validator.

## stETH: The Rebasing Token

stETH is Lido's core token. It **rebases daily** — your wallet balance literally increases every ~24 hours as the oracle reports new validator rewards.

```
Day 1: You hold 10.000000 stETH
Day 2: Oracle reports +0.009% daily reward
Day 2: You now hold 10.000900 stETH (no transaction needed)
```

**Key concepts:**
- 1 stETH ≈ 1 ETH (there can be a small discount/premium on secondary markets)
- Your stETH balance grows automatically — no claiming required
- Under the hood, you own "shares" of the total pool; rebasing adjusts your balance based on share value
- The `sharesOf(address)` value never changes; only the ETH-per-share rate changes

## wstETH: The Non-Rebasing Wrapper

wstETH wraps stETH into a non-rebasing form. The balance stays fixed, but each wstETH becomes worth more stETH over time.

| Property | stETH | wstETH |
|----------|-------|--------|
| Balance changes? | Yes (daily rebase) | No (fixed) |
| Value changes? | Stays ~1 ETH | Increases vs stETH |
| Use in DeFi? | Problematic (rebasing confuses protocols) | Safe (non-rebasing) |
| Tax events? | Each rebase may be taxable | Only on wrap/unwrap |

**When to use which:**
- **stETH** for simple holding, visible daily rewards, human-facing dashboards
- **wstETH** for DeFi (Uniswap, Aave, Morpho, Pendle), cross-chain bridging, or anywhere that expects a standard ERC-20

## The Withdrawal Queue

Unstaking is NOT instant. Lido uses a Withdrawal Queue:

1. You request withdrawal → receive an ERC-721 NFT (your claim ticket)
2. Wait 1-5 days for finalization (depends on Ethereum's exit queue)
3. Once finalized, claim your ETH by burning the NFT

**Constraints:**
- Minimum withdrawal: 100 wei of stETH
- Maximum per request: 1,000 stETH
- For larger amounts, split into multiple requests
- You must approve the Withdrawal Queue to spend your stETH first

## Governance (LDO Token)

Lido DAO uses Aragon for governance:
- **LDO** is the governance token
- You can **delegate** your voting power to another address (the LDO stays in your wallet)
- You can **vote** directly on proposals (yea/nay)
- Votes have a snapshot block — you need LDO balance at that block to vote
- Voting contract: `0x2e59A20f205bB85a89C53f1936454680651E618e` (mainnet)

## Safe Patterns for Agents

### ALWAYS DO:
- Use `dry_run: true` before ANY write operation to preview the outcome
- Check balances before transacting — never assume
- Use `lido_position_summary` to understand the full picture before acting
- Wrap stETH → wstETH before interacting with DeFi protocols
- Monitor the stETH/ETH exchange rate for depegging (historically stays within 0.5%)
- Use exact approval amounts, never unlimited (`type(uint256).max`)

### NEVER DO:
- Don't unstake small amounts — gas cost may exceed the withdrawal value
- Don't assume 1 stETH = exactly 1 ETH (check the exchange rate)
- Don't make rapid successive staking transactions (batch if possible)
- Don't send stETH to contracts that don't handle rebasing tokens
- Don't forget the withdrawal queue delay — it's NOT instant like a DEX swap

## Exchange Rate & Shares

The share exchange rate is how Lido tracks rewards:

```
Your ETH value = your_shares × (total_pooled_ETH / total_shares)
```

When validators earn rewards, `total_pooled_ETH` increases but `total_shares` stays the same → each share is worth more → your stETH balance increases.

The current rate is viewable via `lido_rewards` tool. Historically the rate only goes up (barring slashing events).

## Contract Addresses (Ethereum Mainnet)

| Contract | Address |
|----------|---------|
| stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |
| wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| Withdrawal Queue | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` |
| LDO Token | `0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32` |
| Aragon Voting | `0x2e59A20f205bB85a89C53f1936454680651E618e` |

## MCP Tools Available

| Tool | Type | Description |
|------|------|-------------|
| `lido_stake` | Write | Stake ETH → stETH |
| `lido_unstake` | Write | Request withdrawal via queue |
| `lido_wrap` | Write | stETH → wstETH |
| `lido_unwrap` | Write | wstETH → stETH |
| `lido_balances` | Read | ETH/stETH/wstETH/shares for any address |
| `lido_rewards` | Read | Protocol stats, exchange rate, queue status |
| `lido_withdrawal_status` | Read | Check pending withdrawal request status |
| `lido_delegate_vote` | Write | LDO governance: delegate, vote, or list proposals |
| `lido_position_summary` | Read | Full position analysis with estimated rewards |

All write tools support `dry_run: true`. Use it.

## Further Reading

- Lido docs: https://docs.lido.fi
- stETH integration guide: https://docs.lido.fi/guides/steth-integration-guide
- Withdrawal queue mechanics: https://docs.lido.fi/contracts/withdrawal-queue-erc721
- Deployed contracts: https://docs.lido.fi/deployed-contracts
