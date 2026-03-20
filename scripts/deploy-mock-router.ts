/**
 * Deploy MockRouter + MockUSDC to Sepolia for testnet atomic swap demos.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-mock-router.ts --network sepolia
 *
 * After deployment, add to .env:
 *   MOCK_ROUTER_ADDRESS=<deployed router>
 *   MOCK_TOKEN_OUT_ADDRESS=<deployed USDC>
 *
 * Then add the MockRouter as an allowed target on each user's Treasury:
 *   treasury.addTarget(MOCK_ROUTER_ADDRESS)
 *
 * This lets the agent call treasury.swapYield() on testnet with real on-chain txs.
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MockRouter + MockUSDC with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // 1. Deploy MockUSDC
  console.log("Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("  MockUSDC deployed at:", usdcAddr);

  // 2. Deploy MockRouter with rate 2000e6 (2000 USDC per 1 stETH)
  console.log("Deploying MockRouter (rate: 2000 USDC/stETH)...");
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(ethers.parseUnits("2000", 6));
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("  MockRouter deployed at:", routerAddr);

  console.log("\n══════════════════════════════════════════════");
  console.log("  Add these to your .env:");
  console.log(`  MOCK_ROUTER_ADDRESS=${routerAddr}`);
  console.log(`  MOCK_TOKEN_OUT_ADDRESS=${usdcAddr}`);
  console.log("══════════════════════════════════════════════");
  console.log("\n  Then add MockRouter as an allowed target on each treasury:");
  console.log(`  treasury.addTarget("${routerAddr}")`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
