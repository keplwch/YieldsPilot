/**
 * Uniswap Trading API v1 — Swap Execution
 *
 * Converts stETH yield into USDC or other tokens via Uniswap.
 * Uses the official Uniswap Trading API (https://trade-api.gateway.uniswap.org/v1).
 *
 * Architecture:
 *   The agent does NOT hold or swap tokens directly. Instead:
 *   1. getQuote()          — fetches a quote from Uniswap (/quote)
 *   2. buildContractSwap() — uses the quote to get router calldata (/swap)
 *   3. treasury.swapYield() — the on-chain Treasury contract executes the swap atomically
 *
 *   Funds never leave the Treasury contract. The agent wallet only submits
 *   the transaction that tells the Treasury what to do.
 *
 * Bounty: Uniswap "Agentic Finance" ($5,000)
 */

import { ethers } from "ethers";
import config from "../../config/default";
import type { SwapQuote, SwapResult, DryRunResult } from "../../types/index";

const UNISWAP_API = config.uniswap.baseUrl;
const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": config.uniswap.apiKey,
};

// Common token addresses (Ethereum mainnet)
export const TOKENS: Record<string, string> = {
  stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

// ── Types matching Uniswap Trading API v1 responses ──────────

/** POST /quote response (Uniswap Trading API v1 — current format) */
interface QuoteResponse {
  requestId: string;
  routing: "CLASSIC" | "DUTCH_V2" | "DUTCH_V3" | "PRIORITY" | "LIMIT_ORDER";
  quote: {
    /** Current API fields */
    input?: { amount: string; token: string };
    output?: { amount: string; token: string; recipient: string };
    gasFeeQuote?: string;
    priceImpact?: number;
    aggregatedOutputs?: Array<{ amount: string; minAmount: string; token: string; recipient: string; bps: number }>;
    /** Legacy API fields (kept for backward compat) */
    quoteAmountOut?: string;
    quoteGasAdjustedAmount?: string;
    portionAmount?: string;
    portionBips?: string;
    [key: string]: unknown;
  };
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    values: Record<string, unknown>;
  } | null;
}

/** POST /swap response */
interface SwapResponse {
  requestId: string;
  swap: {
    to: string;
    data: string;
    value: string;
    from: string;
    gasLimit: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string;
  };
  gasFee: string;
}

/** POST /check_approval response */
interface ApprovalResponse {
  requestId: string;
  approval: TransactionRequest | null;
  cancel: TransactionRequest | null;
  gasFee?: string;
  cancelGasFee?: string;
}

interface TransactionRequest {
  to: string;
  data: string;
  value: string;
  from?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  chainId?: number;
}

// ── Params ────────────────────────────────────────────────────

interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  swapper: string;
  slippageTolerance?: number;
}

interface ExecuteSwapParams extends SwapParams {
  wallet: ethers.Wallet;
}

// ── Shared helpers ───────────────────────────────────────────

async function uniswapPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${UNISWAP_API}${endpoint}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Uniswap API ${endpoint} returned ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

/**
 * Get a swap quote from Uniswap Trading API.
 * Used by buildContractSwap() and the wallet-level helpers below.
 */
export async function getQuote({
  tokenIn,
  tokenOut,
  amount,
  swapper,
  slippageTolerance = 0.5,
}: SwapParams): Promise<SwapQuote> {
  const data = await uniswapPost<QuoteResponse>("/quote", {
    type: "EXACT_INPUT",
    tokenInChainId: config.chain.chainId,
    tokenOutChainId: config.chain.chainId,
    tokenIn: TOKENS[tokenIn] ?? tokenIn,
    tokenOut: TOKENS[tokenOut] ?? tokenOut,
    amount: ethers.parseEther(amount.toString()).toString(),
    swapper,
    slippageTolerance,
  });

  // Support both current and legacy Uniswap API response formats
  const amountOut = data.quote?.output?.amount ?? data.quote?.quoteAmountOut;
  if (!amountOut) {
    throw new Error(`Uniswap /quote returned no amount out. Response: ${JSON.stringify(data)}`);
  }

  return {
    quote: data,
    amountOut,
    gasEstimate: data.quote.gasFeeQuote ?? data.quote.quoteGasAdjustedAmount ?? "0",
    route: data.routing,
    priceImpact: data.quote.priceImpact?.toString() ?? data.quote.portionBips ?? "0",
  };
}

// ═══════════════════════════════════════════════════════════════════
//   CONTRACT-LEVEL SWAP — used in production by agent/index.ts
// ═══════════════════════════════════════════════════════════════════

export interface ContractSwapParams {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  /** The Treasury contract address (swap sender/recipient) */
  treasuryAddress: string;
  slippageTolerance?: number;
}

export interface ContractSwapCalldata {
  /** Router address to call */
  router: string;
  /** Hex-encoded calldata for the router */
  calldata: string;
  /** Output token address */
  tokenOut: string;
  /** Minimum output amount (in wei) */
  minAmountOut: string;
  /** Expected output for display */
  expectedOutput: string;
  /** Price impact percentage */
  priceImpact: string;
}

/**
 * Fetches a Uniswap quote and builds router calldata for the Treasury
 * contract to execute via its `swapYield()` function.
 *
 * The Treasury is set as the `swapper` so the API builds calldata
 * where the Treasury is msg.sender to the router. The contract then:
 *   1. Approves the router for the exact stETH amount
 *   2. Calls the router with this calldata
 *   3. Verifies minAmountOut was received
 *   4. Resets approval to zero
 */
export async function buildContractSwap({
  tokenIn,
  tokenOut,
  amount,
  treasuryAddress,
  slippageTolerance = 0.5,
}: ContractSwapParams): Promise<ContractSwapCalldata> {
  const tokenOutAddr = TOKENS[tokenOut] ?? tokenOut;

  // Step 1: Get quote with the treasury as the swapper
  const quoteResult = await getQuote({ tokenIn, tokenOut, amount, swapper: treasuryAddress, slippageTolerance });
  const quoteData = quoteResult.quote as QuoteResponse;

  if (quoteData.routing !== "CLASSIC") {
    throw new Error(`Treasury swaps require CLASSIC routing, got: ${quoteData.routing}`);
  }

  console.log(`      📊 Quote: ${quoteResult.amountOut} out (gas-adjusted: ${quoteResult.gasEstimate}), routing: ${quoteData.routing}`);

  // Step 2: Build transaction calldata via /swap
  const swapData = await uniswapPost<SwapResponse>("/swap", {
    quote: quoteData.quote,
    simulateTransaction: false,
  });

  if (!swapData.swap?.to || !swapData.swap?.data) {
    throw new Error(`Uniswap /swap returned no transaction. Response: ${JSON.stringify(swapData)}`);
  }

  // Calculate minAmountOut with slippage
  const expectedOut = BigInt(quoteResult.amountOut);
  const slippageBps = Math.floor(slippageTolerance * 100); // 0.5% → 50 bps
  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10000n;

  return {
    router: swapData.swap.to,
    calldata: swapData.swap.data,
    tokenOut: tokenOutAddr,
    minAmountOut: minOut.toString(),
    expectedOutput: quoteResult.amountOut,
    priceImpact: quoteResult.priceImpact,
  };
}

// ═══════════════════════════════════════════════════════════════════
//   WALLET-LEVEL SWAP
// ═══════════════════════════════════════════════════════════════════
// The functions below (checkApproval, executeSwap, dryRun) implement
// a direct wallet-swap flow where the agent wallet holds tokens and
// swaps them itself. This bypasses the Treasury's principal protection.
// Kept for potential future use (MCP tools, direct wallet mode, testing).

/**
 * Check if token approval is needed before a wallet-level swap.
 * Not needed for contract-level swaps — the Treasury handles its own approvals.
 */
export async function checkApproval({
  walletAddress,
  token,
  amount,
  chainId,
}: {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
}): Promise<ApprovalResponse> {
  return uniswapPost<ApprovalResponse>("/check_approval", {
    walletAddress,
    token: TOKENS[token] ?? token,
    amount,
    chainId,
    includeGasInfo: true,
  });
}

/**
 * Execute a swap from the agent wallet directly.
 * Not used — the agent swaps via treasury.swapYield() (contract-level).
 * Flow: check_approval → quote → swap → sign & broadcast.
 */
export async function executeSwap({
  tokenIn,
  tokenOut,
  amount,
  swapper,
  slippageTolerance = 0.5,
  wallet,
}: ExecuteSwapParams): Promise<SwapResult> {
  const tokenInAddr = TOKENS[tokenIn] ?? tokenIn;
  const amountWei = ethers.parseEther(amount.toString()).toString();

  // Step 1: Check if approval is needed
  const approval = await checkApproval({
    walletAddress: swapper,
    token: tokenInAddr,
    amount: amountWei,
    chainId: config.chain.chainId,
  });

  if (approval.cancel) {
    console.log(`      🔄 Resetting existing approval...`);
    const cancelTx = await wallet.sendTransaction({
      to: approval.cancel.to,
      data: approval.cancel.data,
      value: approval.cancel.value,
      gasLimit: approval.cancel.gasLimit,
    });
    await cancelTx.wait();
  }

  if (approval.approval) {
    console.log(`      ✅ Approving token spend...`);
    const approveTx = await wallet.sendTransaction({
      to: approval.approval.to,
      data: approval.approval.data,
      value: approval.approval.value,
      gasLimit: approval.approval.gasLimit,
    });
    await approveTx.wait();
  }

  // Step 2: Get quote
  const quoteResult = await getQuote({ tokenIn, tokenOut, amount, swapper, slippageTolerance });
  const quoteData = quoteResult.quote as QuoteResponse;

  if (quoteData.routing !== "CLASSIC") {
    throw new Error(`Unsupported routing type: ${quoteData.routing}. Only CLASSIC swaps supported.`);
  }

  // Step 3: Build swap transaction from quote
  const swapData = await uniswapPost<SwapResponse>("/swap", {
    quote: quoteData.quote,
    simulateTransaction: false,
  });

  if (!swapData.swap?.to || !swapData.swap?.data) {
    throw new Error(`Swap creation failed: ${JSON.stringify(swapData)}`);
  }

  // Step 4: Sign and send the transaction
  const tx = await wallet.sendTransaction({
    to: swapData.swap.to,
    data: swapData.swap.data,
    value: swapData.swap.value ?? "0",
    gasLimit: swapData.swap.gasLimit,
  });

  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Transaction receipt is null");
  }

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status === 1 ? "success" : "failed",
    tokenIn,
    tokenOut,
    amountIn: amount.toString(),
    amountOut: quoteResult.amountOut,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Dry run: get a quote without executing. Useful for planning and risk assessment.
 * Not used in production — kept for MCP tools and testing.
 */
export async function dryRun({
  tokenIn,
  tokenOut,
  amount,
  swapper,
}: Omit<SwapParams, "slippageTolerance">): Promise<DryRunResult> {
  const quote = await getQuote({ tokenIn, tokenOut, amount, swapper });
  return {
    dryRun: true,
    wouldReceive: quote.amountOut,
    priceImpact: quote.priceImpact,
    gasEstimate: quote.gasEstimate,
    route: quote.route,
  };
}
