/**
 * Uniswap Trading API — Real Swap Execution
 *
 * Converts stETH yield into USDC or other tokens via Uniswap.
 * Uses the official Uniswap Trading API with real TxIDs.
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

// ── Types for API responses ───────────────────────────────────

interface UniswapQuoteResponse {
  quote?: {
    amountOut: string;
    gasEstimate: string;
    route: unknown;
    priceImpact: string;
  };
}

interface UniswapSwapResponse {
  swap?: {
    to: string;
    calldata: string;
    value?: string;
    gasLimit: string;
  };
}

// ── Params ────────────────────────────────────────────────────

interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageTolerance?: number;
}

interface ExecuteSwapParams extends SwapParams {
  wallet: ethers.Wallet;
}

// ── Functions ─────────────────────────────────────────────────

/**
 * Get a swap quote from Uniswap Trading API.
 */
export async function getQuote({
  tokenIn,
  tokenOut,
  amount,
  slippageTolerance = 0.5,
}: SwapParams): Promise<SwapQuote> {
  const response = await fetch(`${UNISWAP_API}/quote`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      tokenInChainId: config.chain.chainId,
      tokenOutChainId: config.chain.chainId,
      tokenIn: TOKENS[tokenIn] ?? tokenIn,
      tokenOut: TOKENS[tokenOut] ?? tokenOut,
      amount: amount.toString(),
      type: "EXACT_INPUT",
      slippageTolerance,
      configs: [
        {
          routingType: "CLASSIC",
          protocols: ["V2", "V3", "MIXED"],
        },
      ],
    }),
  });

  const data = (await response.json()) as UniswapQuoteResponse;

  return {
    quote: data,
    amountOut: data.quote?.amountOut ?? "0",
    gasEstimate: data.quote?.gasEstimate ?? "0",
    route: data.quote?.route ?? null,
    priceImpact: data.quote?.priceImpact ?? "0",
  };
}

/**
 * Execute a swap via the Uniswap Trading API.
 * Returns a real transaction hash.
 */
export async function executeSwap({
  tokenIn,
  tokenOut,
  amount,
  slippageTolerance = 0.5,
  wallet,
}: ExecuteSwapParams): Promise<SwapResult> {
  // Step 1: Get quote
  const quoteResult = await getQuote({ tokenIn, tokenOut, amount, slippageTolerance });

  if (!quoteResult.quote) {
    throw new Error("Failed to get Uniswap quote");
  }

  // Step 2: Build transaction from quote
  const swapResponse = await fetch(`${UNISWAP_API}/swap`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      quote: quoteResult.quote,
      simulateTransaction: false,
    }),
  });

  const swapData = (await swapResponse.json()) as UniswapSwapResponse;

  if (!swapData.swap) {
    throw new Error(`Swap creation failed: ${JSON.stringify(swapData)}`);
  }

  // Step 3: Sign and send the transaction
  const tx = await wallet.sendTransaction({
    to: swapData.swap.to,
    data: swapData.swap.calldata,
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
 * Dry run: get quote without executing.
 * Useful for agent planning and risk assessment.
 */
export async function dryRun({
  tokenIn,
  tokenOut,
  amount,
}: Omit<SwapParams, "slippageTolerance">): Promise<DryRunResult> {
  const quote = await getQuote({ tokenIn, tokenOut, amount });
  return {
    dryRun: true,
    wouldReceive: quote.amountOut,
    priceImpact: quote.priceImpact,
    gasEstimate: quote.gasEstimate,
    route: quote.route,
  };
}

// ═══════════════════════════════════════════════════════════════════
//          CONTRACT-LEVEL SWAP (Treasury calls router directly)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build swap calldata for the treasury contract to execute.
 *
 * Instead of the agent wallet holding funds and swapping, the Treasury
 * contract calls the router directly. This function returns the calldata
 * the Treasury needs to pass to `swapYield()`.
 *
 * Security: Funds never leave the Treasury contract. The contract:
 *   1. Approves the router for the exact stETH amount
 *   2. Calls the router with this calldata
 *   3. Verifies minAmountOut was received
 *   4. Resets approval to zero
 */
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
 * Gets a Uniswap quote and builds calldata that the Treasury contract
 * can execute via its `swapYield()` function.
 *
 * The key difference from `executeSwap()`: the `swapper` (recipient of
 * input tokens, sender of calldata) is the Treasury contract address,
 * NOT the agent wallet.
 */
export async function buildContractSwap({
  tokenIn,
  tokenOut,
  amount,
  treasuryAddress,
  slippageTolerance = 0.5,
}: ContractSwapParams): Promise<ContractSwapCalldata> {
  const tokenInAddr = TOKENS[tokenIn] ?? tokenIn;
  const tokenOutAddr = TOKENS[tokenOut] ?? tokenOut;

  // Step 1: Get quote with the treasury as the swapper
  const quoteResponse = await fetch(`${UNISWAP_API}/quote`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      tokenInChainId: config.chain.chainId,
      tokenOutChainId: config.chain.chainId,
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amount: amount.toString(),
      type: "EXACT_INPUT",
      slippageTolerance,
      swapper: treasuryAddress,          // Treasury is the swap origin
      configs: [
        {
          routingType: "CLASSIC",
          protocols: ["V2", "V3", "MIXED"],
          recipient: treasuryAddress,      // Output goes back to Treasury
        },
      ],
    }),
  });

  const quoteData = (await quoteResponse.json()) as UniswapQuoteResponse;

  if (!quoteData.quote) {
    throw new Error(`Failed to get Uniswap quote: ${JSON.stringify(quoteData)}`);
  }

  // Step 2: Build transaction calldata
  const swapResponse = await fetch(`${UNISWAP_API}/swap`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      quote: quoteData.quote,
      simulateTransaction: false,
    }),
  });

  const swapData = (await swapResponse.json()) as UniswapSwapResponse;

  if (!swapData.swap) {
    throw new Error(`Swap build failed: ${JSON.stringify(swapData)}`);
  }

  // Calculate minAmountOut with slippage
  const expectedOut = BigInt(quoteData.quote.amountOut);
  const slippageBps = Math.floor(slippageTolerance * 100); // 0.5% → 50 bps
  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10000n;

  return {
    router: swapData.swap.to,
    calldata: swapData.swap.calldata,
    tokenOut: tokenOutAddr,
    minAmountOut: minOut.toString(),
    expectedOutput: quoteData.quote.amountOut,
    priceImpact: quoteData.quote.priceImpact,
  };
}
