/**
 * Deploy MockStETH + YieldPilotRegistry for local/Sepolia testing
 *
 * Usage:
 *   npx hardhat run scripts/deploy-mock.ts --network sepolia
 *
 * What this does:
 *   1. Deploys MockStETH (gives deployer 1000 stETH)
 *   2. Deploys YieldPilotRegistry pointing to MockStETH
 *   3. Prints .env values to copy
 */

import { ethers } from "hardhat";

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🧪 Deploying Mock Stack to Sepolia             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const agentAddress = process.env.AGENT_WALLET || deployer.address;

  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Agent:     ${agentAddress}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ── 1. Deploy MockStETH ────────────────────────────────
  console.log("Deploying MockStETH...");
  const MockStETH = await ethers.getContractFactory("MockStETH");
  const mockStETH = await MockStETH.deploy();
  await mockStETH.waitForDeployment();
  const mockStETHAddress = await mockStETH.getAddress();
  console.log(`✅ MockStETH: ${mockStETHAddress}`);

  const deployerBalance = await mockStETH.balanceOf(deployer.address);
  console.log(`   Deployer balance: ${ethers.formatEther(deployerBalance)} stETH\n`);

  // ── 2. Deploy Registry pointing to MockStETH ──────────
  console.log("Deploying YieldPilotRegistry (mock stETH)...");
  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(
    mockStETHAddress,
    agentAddress,
    5000 // 50% daily spend cap
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`✅ Registry: ${registryAddress}\n`);

  // ── 3. Add Uniswap Router as default target ────────────
  const UNISWAP_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  try {
    const tx = await registry.addDefaultTarget(UNISWAP_ROUTER);
    await tx.wait();
    console.log(`✅ Uniswap Router added as target: ${UNISWAP_ROUTER}\n`);
  } catch {
    console.log("⚠ Could not add Uniswap target (may not exist on this network)\n");
  }

  // ── Summary ────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   ✅ Mock Stack Deployed!                        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`
  Copy these into your .env:

    STETH_ADDRESS=${mockStETHAddress}
    REGISTRY_CONTRACT=${registryAddress}

  Also update the frontend constant in DepositPanel.tsx:
    STETH_ADDRESS = "${mockStETHAddress}"

  Testing workflow:
    1. Drip yourself stETH:
       npx hardhat run scripts/mint-mock.ts --network sepolia

    2. Open the dashboard, deposit mock stETH

    3. Simulate yield accrual (after treasury is created):
       TREASURY=<your-treasury-address> npx hardhat run scripts/simulate-yield.ts --network sepolia

    4. Watch the agent reason and act on the available yield
  `);
}

main().catch((e) => { console.error(e); process.exit(1); });
