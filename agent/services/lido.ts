/**
 * Lido Protocol Service — stETH Operations
 *
 * Handles all Lido interactions: stake, unstake, wrap/unwrap,
 * balance queries, and reward tracking.
 *
 * Bounty: Lido "stETH Agent Treasury" ($3,000) + "Lido MCP" ($5,000)
 */

import { ethers } from "ethers";
import config from "../../config/default";
import type {
  BalancesResult,
  ProtocolStats,
  LidoOperationResult,
} from "../../types/index";

// ── Minimal ABIs ──────────────────────────────────────────────

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

const WITHDRAWAL_ABI = [
  "function requestWithdrawals(uint256[] amounts, address owner) returns (uint256[])",
  "function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])",
  "function claimWithdrawals(uint256[] requestIds, uint256[] hints)",
] as const;

const TREASURY_ABI = [
  "function principal() view returns (uint256)",
  "function availableYield() view returns (uint256)",
  "function totalBalance() view returns (uint256)",
  "function yieldWithdrawn() view returns (uint256)",
  "function maxDailySpendBps() view returns (uint256)",
  "function dailySpendRemaining() view returns (uint256)",
  "function spendYield(address target, uint256 amount, string reason)",
  "function swapYield(address router, uint256 amountIn, bytes swapCalldata, address tokenOut, uint256 minAmountOut, string reason)",
  "function withdrawToken(address token, address to, uint256 amount)",
  "function deposit(uint256 amount)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
] as const;

const REGISTRY_ABI = [
  "function treasuryCount() view returns (uint256)",
  "function getAllTreasuries() view returns (address[])",
  "function getAllUsers() view returns (address[])",
  "function getUserTreasuryPairs(uint256 offset, uint256 limit) view returns (address[] users, address[] treasuries)",
  "function userTreasury(address) view returns (address)",
  "function agent() view returns (address)",
  "function admin() view returns (address)",
] as const;

// ── Module State ──────────────────────────────────────────────

let provider: ethers.JsonRpcProvider;
let wallet: ethers.Wallet;
let stETH: ethers.Contract;
let wstETH: ethers.Contract;
let withdrawal: ethers.Contract;
let treasury: ethers.Contract | null = null;
let registry: ethers.Contract | null = null;

// ── Init ──────────────────────────────────────────────────────

export function init(
  rpcUrl?: string,
  privateKey?: string,
  treasuryAddress?: string,
  registryAddress?: string
) {
  provider = new ethers.JsonRpcProvider(rpcUrl ?? config.chain.rpcUrl);
  wallet = new ethers.Wallet(privateKey ?? config.chain.agentPrivateKey, provider);

  stETH = new ethers.Contract(config.lido.stETH, STETH_ABI, wallet);
  wstETH = new ethers.Contract(config.lido.wstETH, WSTETH_ABI, wallet);
  withdrawal = new ethers.Contract(config.lido.withdrawalQueue, WITHDRAWAL_ABI, wallet);

  const addr = treasuryAddress ?? config.treasury.address;
  if (addr) {
    treasury = new ethers.Contract(addr, TREASURY_ABI, wallet);
  }

  const regAddr = registryAddress ?? (config as any).registry?.address ?? process.env.REGISTRY_CONTRACT;
  if (regAddr) {
    registry = new ethers.Contract(regAddr, REGISTRY_ABI, wallet);
  }

  return { provider, wallet, stETH, wstETH, withdrawal, treasury, registry };
}

export function getWallet(): ethers.Wallet {
  return wallet;
}

// ════════════════════════════════════════════════════════════════
//                     STAKING OPERATIONS
// ════════════════════════════════════════════════════════════════

export async function stake(
  amountEth: number | string,
  dryRun = false
): Promise<LidoOperationResult> {
  const amount = ethers.parseEther(amountEth.toString());

  if (dryRun) {
    const shares: bigint = await stETH.getSharesByPooledEth(amount);
    return {
      dryRun: true,
      action: "stake",
      inputEth: amountEth.toString(),
      expectedShares: ethers.formatUnits(shares, 18),
      estimatedStETH: amountEth.toString(),
    };
  }

  const tx = await stETH.submit(ethers.ZeroAddress, { value: amount });
  const receipt = await tx.wait();

  return {
    action: "stake",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    inputEth: amountEth.toString(),
    timestamp: new Date().toISOString(),
  };
}

export async function unstake(
  amountStEth: number | string,
  dryRun = false
): Promise<LidoOperationResult> {
  const amount = ethers.parseEther(amountStEth.toString());

  if (dryRun) {
    return {
      dryRun: true,
      action: "unstake",
      inputStETH: amountStEth.toString(),
      note: "Withdrawal requests take 1-5 days to finalize",
    };
  }

  const approveTx = await stETH.approve(config.lido.withdrawalQueue, amount);
  await approveTx.wait();

  const tx = await withdrawal.requestWithdrawals([amount], wallet.address);
  const receipt = await tx.wait();

  return {
    action: "unstake",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    inputStETH: amountStEth.toString(),
    timestamp: new Date().toISOString(),
  };
}

export async function wrap(
  amountStEth: number | string,
  dryRun = false
): Promise<LidoOperationResult> {
  const amount = ethers.parseEther(amountStEth.toString());

  if (dryRun) {
    const wstAmount: bigint = await wstETH.getWstETHByStETH(amount);
    return {
      dryRun: true,
      action: "wrap",
      inputStETH: amountStEth.toString(),
      expectedWstETH: ethers.formatUnits(wstAmount, 18),
    };
  }

  const approveTx = await stETH.approve(config.lido.wstETH, amount);
  await approveTx.wait();

  const tx = await wstETH.wrap(amount);
  const receipt = await tx.wait();

  return {
    action: "wrap",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    inputStETH: amountStEth.toString(),
    timestamp: new Date().toISOString(),
  };
}

export async function unwrap(
  amountWstEth: number | string,
  dryRun = false
): Promise<LidoOperationResult> {
  const amount = ethers.parseEther(amountWstEth.toString());

  if (dryRun) {
    const stAmount: bigint = await wstETH.getStETHByWstETH(amount);
    return {
      dryRun: true,
      action: "unwrap",
      inputWstETH: amountWstEth.toString(),
      expectedStETH: ethers.formatUnits(stAmount, 18),
    };
  }

  const tx = await wstETH.unwrap(amount);
  const receipt = await tx.wait();

  return {
    action: "unwrap",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    inputWstETH: amountWstEth.toString(),
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════
//                     BALANCE & REWARDS
// ════════════════════════════════════════════════════════════════

export async function getBalances(address?: string): Promise<BalancesResult> {
  const addr = address ?? wallet.address;

  const [stEthBal, wstEthBal, ethBal] = await Promise.all([
    stETH.balanceOf(addr) as Promise<bigint>,
    wstETH.balanceOf(addr) as Promise<bigint>,
    provider.getBalance(addr),
  ]);

  const result: BalancesResult = {
    address: addr,
    eth: ethers.formatEther(ethBal),
    stETH: ethers.formatEther(stEthBal),
    wstETH: ethers.formatEther(wstEthBal),
  };

  if (treasury) {
    const [principal, availYield, totalBal, yieldWithdrawn, maxDaily, dailyRemaining, paused] =
      await Promise.all([
        treasury.principal() as Promise<bigint>,
        treasury.availableYield() as Promise<bigint>,
        treasury.totalBalance() as Promise<bigint>,
        treasury.yieldWithdrawn() as Promise<bigint>,
        treasury.maxDailySpendBps() as Promise<bigint>,
        treasury.dailySpendRemaining() as Promise<bigint>,
        treasury.paused() as Promise<boolean>,
      ]);

    result.treasury = {
      principal: ethers.formatEther(principal),
      availableYield: ethers.formatEther(availYield),
      totalBalance: ethers.formatEther(totalBal),
      yieldWithdrawn: ethers.formatEther(yieldWithdrawn),
      maxDailySpendBps: maxDaily.toString(),
      dailySpendRemaining: ethers.formatEther(dailyRemaining),
      paused,
    };
  }

  return result;
}

export async function getProtocolStats(): Promise<ProtocolStats> {
  const [totalPooled, totalShares, stEthPerWstEth] = await Promise.all([
    stETH.getTotalPooledEther() as Promise<bigint>,
    stETH.getTotalShares() as Promise<bigint>,
    wstETH.stEthPerToken() as Promise<bigint>,
  ]);

  return {
    totalPooledEther: ethers.formatEther(totalPooled),
    totalShares: ethers.formatEther(totalShares),
    stEthPerWstEth: ethers.formatEther(stEthPerWstEth),
    exchangeRate: (
      Number(ethers.formatEther(totalPooled)) /
      Number(ethers.formatEther(totalShares))
    ).toFixed(6),
  };
}

// ════════════════════════════════════════════════════════════════
//                     TREASURY OPERATIONS
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//                 MULTI-USER (REGISTRY) OPERATIONS
// ════════════════════════════════════════════════════════════════

export interface UserTreasuryInfo {
  user: string;
  treasuryAddress: string;
  principal: string;
  availableYield: string;
  totalBalance: string;
  yieldWithdrawn: string;
  maxDailySpendBps: string;
  dailySpendRemaining: string;
  paused: boolean;
}

/**
 * Get all registered treasuries from the Registry contract.
 * Returns user-treasury pairs with their balances.
 */
export async function getAllUserTreasuries(): Promise<UserTreasuryInfo[]> {
  if (!registry) {
    // Fallback: use single treasury if no registry
    if (treasury) {
      const balances = await getBalances();
      return [{
        user: "single-user",
        treasuryAddress: config.treasury.address,
        principal: balances.treasury?.principal ?? "0",
        availableYield: balances.treasury?.availableYield ?? "0",
        totalBalance: balances.treasury?.totalBalance ?? "0",
        yieldWithdrawn: balances.treasury?.yieldWithdrawn ?? "0",
        maxDailySpendBps: balances.treasury?.maxDailySpendBps ?? "0",
        dailySpendRemaining: balances.treasury?.dailySpendRemaining ?? "0",
        paused: balances.treasury?.paused ?? false,
      }];
    }
    return [];
  }

  const count: bigint = await registry.treasuryCount();
  if (count === 0n) return [];

  const [users, treasuries]: [string[], string[]] = await registry.getUserTreasuryPairs(0, count);

  const results: UserTreasuryInfo[] = [];

  for (let i = 0; i < users.length; i++) {
    try {
      const t = new ethers.Contract(treasuries[i], TREASURY_ABI, provider);

      const [principal, availYield, totalBal, yieldWith, maxDaily, dailyRem, paused] =
        await Promise.all([
          t.principal() as Promise<bigint>,
          t.availableYield() as Promise<bigint>,
          t.totalBalance() as Promise<bigint>,
          t.yieldWithdrawn() as Promise<bigint>,
          t.maxDailySpendBps() as Promise<bigint>,
          t.dailySpendRemaining() as Promise<bigint>,
          t.paused() as Promise<boolean>,
        ]);

      results.push({
        user: users[i],
        treasuryAddress: treasuries[i],
        principal: ethers.formatEther(principal),
        availableYield: ethers.formatEther(availYield),
        totalBalance: ethers.formatEther(totalBal),
        yieldWithdrawn: ethers.formatEther(yieldWith),
        maxDailySpendBps: maxDaily.toString(),
        dailySpendRemaining: ethers.formatEther(dailyRem),
        paused,
      });
    } catch (err) {
      console.warn(`  ⚠ Failed to read treasury ${treasuries[i]} for user ${users[i]}: ${(err as Error).message}`);
    }
  }

  return results;
}

/**
 * Spend yield from a specific user's treasury.
 */
export async function spendYieldFromTreasury(
  treasuryAddress: string,
  target: string,
  amountStEth: number | string,
  reason: string,
  dryRun = false
): Promise<LidoOperationResult> {
  const t = new ethers.Contract(treasuryAddress, TREASURY_ABI, wallet);
  const amount = ethers.parseEther(amountStEth.toString());

  if (dryRun) {
    const available: bigint = await t.availableYield();
    const dailyRemaining: bigint = await t.dailySpendRemaining();
    return {
      dryRun: true,
      action: "spend_yield",
      target,
      amount: amountStEth.toString(),
      reason,
      treasuryAddress,
      availableYield: ethers.formatEther(available),
      dailyRemaining: ethers.formatEther(dailyRemaining),
      wouldSucceed: amount <= available && amount <= dailyRemaining,
    };
  }

  const tx = await t.spendYield(target, amount, reason);
  const receipt = await tx.wait();

  return {
    action: "spend_yield",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    target,
    amount: amountStEth.toString(),
    treasuryAddress,
    reason,
    timestamp: new Date().toISOString(),
  };
}

export async function spendYield(
  target: string,
  amountStEth: number | string,
  reason: string,
  dryRun = false
): Promise<LidoOperationResult> {
  if (!treasury) throw new Error("Treasury not initialized");

  const amount = ethers.parseEther(amountStEth.toString());

  if (dryRun) {
    const available: bigint = await treasury.availableYield();
    const dailyRemaining: bigint = await treasury.dailySpendRemaining();
    return {
      dryRun: true,
      action: "spend_yield",
      target,
      amount: amountStEth.toString(),
      reason,
      availableYield: ethers.formatEther(available),
      dailyRemaining: ethers.formatEther(dailyRemaining),
      wouldSucceed: amount <= available && amount <= dailyRemaining,
    };
  }

  const tx = await treasury.spendYield(target, amount, reason);
  const receipt = await tx.wait();

  return {
    action: "spend_yield",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    target,
    amount: amountStEth.toString(),
    reason,
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════
//                  ATOMIC SWAP (Secure — no agent custody)
// ════════════════════════════════════════════════════════════════

export interface SwapYieldParams {
  treasuryAddress: string;
  routerAddress: string;
  amountIn: string;          // stETH amount (in ether units)
  swapCalldata: string;       // hex-encoded calldata from Uniswap API
  tokenOut: string;           // output token address
  minAmountOut: string;       // minimum output (in wei)
  reason: string;
}

/**
 * Execute an atomic swap from a user's treasury.
 * The treasury approves the router, calls it with swap calldata,
 * and verifies output — funds NEVER pass through the agent wallet.
 */
export async function swapYieldFromTreasury(
  params: SwapYieldParams,
  dryRun = false
): Promise<LidoOperationResult> {
  const t = new ethers.Contract(params.treasuryAddress, TREASURY_ABI, wallet);
  const amountIn = ethers.parseEther(params.amountIn);

  if (dryRun) {
    const available: bigint = await t.availableYield();
    const dailyRemaining: bigint = await t.dailySpendRemaining();
    return {
      dryRun: true,
      action: "swap_yield",
      treasuryAddress: params.treasuryAddress,
      router: params.routerAddress,
      amountIn: params.amountIn,
      tokenOut: params.tokenOut,
      reason: params.reason,
      availableYield: ethers.formatEther(available),
      dailyRemaining: ethers.formatEther(dailyRemaining),
      wouldSucceed: amountIn <= available && amountIn <= dailyRemaining,
    };
  }

  const tx = await t.swapYield(
    params.routerAddress,
    amountIn,
    params.swapCalldata,
    params.tokenOut,
    params.minAmountOut,
    params.reason
  );
  const receipt = await tx.wait();

  return {
    action: "swap_yield",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    treasuryAddress: params.treasuryAddress,
    router: params.routerAddress,
    amountIn: params.amountIn,
    tokenOut: params.tokenOut,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  };
}

/**
 * After a swap, withdraw the output tokens from the treasury to a target.
 */
export async function withdrawSwapOutput(
  treasuryAddress: string,
  token: string,
  to: string,
  amount: string
): Promise<LidoOperationResult> {
  const t = new ethers.Contract(treasuryAddress, TREASURY_ABI, wallet);

  const tx = await t.withdrawToken(token, to, amount);
  const receipt = await tx.wait();

  return {
    action: "withdraw_token",
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    treasuryAddress,
    token,
    to,
    amount,
    timestamp: new Date().toISOString(),
  };
}
