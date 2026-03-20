/**
 * YieldPilot — Fresh Full Deploy
 *
 * Deploys EVERYTHING in one shot:
 *   1. MockStETH (if STETH_ADDRESS not set — for local testing)
 *   2. MockUSDC (output token for testnet swaps)
 *   3. MockRouter (simulates Uniswap on testnet)
 *   4. YieldPilotRegistry (multi-user factory)
 *   5. Adds MockRouter + Uniswap Router as default targets on Registry
 *   6. Prints all addresses + ready-to-paste .env block
 *
 * Usage:
 *   npx hardhat run scripts/deploy-fresh.ts --network sepolia
 *
 * After deployment:
 *   1. Paste the .env block into your .env file
 *   2. Restart the agent: bun run agent
 *   3. Create a user treasury from the UI (deposit stETH)
 *   4. The agent will use swapYield() with the MockRouter for atomic swaps
 */

import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🚀 YieldPilot — Fresh Full Deploy                     ║");
  console.log("║   Deploys: MockUSDC + MockRouter + Registry             ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`Network:   ${(await ethers.provider.getNetwork()).chainId}\n`);

  if (balance === 0n) {
    console.error("❌ Deployer has zero balance. Get Sepolia ETH from a faucet first.");
    process.exit(1);
  }

  // ── Config ─────────────────────────────────────────────────
  const STETH_ADDRESS = process.env.STETH_ADDRESS || "0x6df25A1734E181AFbBD9c8A50b1D00e39D482704";
  const AGENT_ADDRESS = process.env.AGENT_WALLET || deployer.address;
  const UNISWAP_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  const DEFAULT_MAX_DAILY_BPS = 5000; // 50%

  console.log(`Config:`);
  console.log(`  stETH:         ${STETH_ADDRESS}`);
  console.log(`  Agent:         ${AGENT_ADDRESS}`);
  console.log(`  Uniswap Rtr:   ${UNISWAP_ROUTER}`);
  console.log(`  Daily limit:   ${DEFAULT_MAX_DAILY_BPS} bps (${DEFAULT_MAX_DAILY_BPS / 100}%)\n`);

  // ═══════════════════════════════════════════════════════════
  //  Step 1: Deploy MockUSDC
  // ═══════════════════════════════════════════════════════════
  console.log("━━━ Step 1/4: Deploying MockUSDC ━━━");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC:     ${usdcAddress}`);
  console.log(`     tx: ${usdc.deploymentTransaction()?.hash}\n`);

  // ═══════════════════════════════════════════════════════════
  //  Step 2: Deploy MockRouter
  // ═══════════════════════════════════════════════════════════
  console.log("━━━ Step 2/4: Deploying MockRouter ━━━");
  // Rate: 2000 USDC per 1 stETH (2000 * 10^6 because USDC has 6 decimals)
  const RATE = ethers.parseUnits("2000", 6);
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(RATE);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`  ✅ MockRouter:   ${routerAddress}`);
  console.log(`     Rate: 2000 USDC per 1 stETH`);
  console.log(`     tx: ${router.deploymentTransaction()?.hash}\n`);

  // ═══════════════════════════════════════════════════════════
  //  Step 3: Deploy Registry
  // ═══════════════════════════════════════════════════════════
  console.log("━━━ Step 3/4: Deploying YieldPilotRegistry ━━━");
  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(
    STETH_ADDRESS,
    AGENT_ADDRESS,
    DEFAULT_MAX_DAILY_BPS
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  ✅ Registry:     ${registryAddress}`);
  console.log(`     tx: ${registry.deploymentTransaction()?.hash}\n`);

  // ═══════════════════════════════════════════════════════════
  //  Step 4: Configure Registry default targets
  // ═══════════════════════════════════════════════════════════
  console.log("━━━ Step 4/4: Configuring default targets ━━━");

  // Add Uniswap Router as default target
  console.log(`  Adding Uniswap Router: ${UNISWAP_ROUTER}...`);
  const tx1 = await registry.addDefaultTarget(UNISWAP_ROUTER);
  await tx1.wait();
  console.log(`  ✅ Uniswap Router added`);

  // Add MockRouter as default target
  console.log(`  Adding MockRouter: ${routerAddress}...`);
  const tx2 = await registry.addDefaultTarget(routerAddress);
  await tx2.wait();
  console.log(`  ✅ MockRouter added`);

  // Verify targets
  const targets = await registry.getDefaultTargets();
  console.log(`\n  Default targets (${targets.length}):`);
  for (const t of targets) {
    console.log(`    • ${t}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Summary + .env output
  // ═══════════════════════════════════════════════════════════
  const envBlock = `
# ═══ YieldPilot Fresh Deploy — ${new Date().toISOString()} ═══
REGISTRY_CONTRACT=${registryAddress}
MOCK_ROUTER_ADDRESS=${routerAddress}
MOCK_TOKEN_OUT_ADDRESS=${usdcAddress}
STETH_ADDRESS=${STETH_ADDRESS}
`.trim();

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ✅ FULL DEPLOYMENT COMPLETE!                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │ Contract          │ Address                              │
  ├─────────────────────────────────────────────────────────┤
  │ MockUSDC          │ ${usdcAddress} │
  │ MockRouter        │ ${routerAddress} │
  │ Registry          │ ${registryAddress} │
  └─────────────────────────────────────────────────────────┘

  ━━━ Paste this into your .env ━━━

${envBlock}

  ━━━ What's next ━━━

  1. Update your .env with the values above
  2. Restart the agent:  bun run agent
  3. Open the frontend and connect wallet
  4. Deposit stETH → creates your Treasury via Registry
  5. The agent will use swapYield() with MockRouter for atomic swaps!

  ━━━ How it works on testnet ━━━

  Agent detects testnet + MOCK_ROUTER_ADDRESS is set →
  Builds MockRouter.swap() calldata →
  Calls treasury.swapYield(mockRouter, amount, calldata, usdc, 0, reason) →
  Treasury approves MockRouter → MockRouter pulls stETH, mints USDC →
  USDC lands in Treasury (funds never leave contract!)

  On Etherscan you'll see method "swapYield" instead of plain transfers.
`);

  // Also write a deploy manifest for reference
  const manifest = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: {
      mockUSDC: usdcAddress,
      mockRouter: routerAddress,
      registry: registryAddress,
    },
    config: {
      stETH: STETH_ADDRESS,
      agent: AGENT_ADDRESS,
      uniswapRouter: UNISWAP_ROUTER,
      maxDailyBps: DEFAULT_MAX_DAILY_BPS,
      mockRouterRate: "2000 USDC/stETH",
    },
    defaultTargets: targets.map((t: string) => t),
    envBlock,
  };

  const manifestPath = path.resolve(process.cwd(), "deploy-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  📄 Deploy manifest saved to: deploy-manifest.json\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
