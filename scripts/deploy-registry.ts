/**
 * Deploy YieldPilotRegistry to Ethereum Sepolia
 *
 * The Registry is a factory that creates per-user Treasury contracts.
 * It shares one agent address across all treasuries.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-registry.ts --network sepolia
 */

import { ethers } from "hardhat";

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🏭 Deploying YieldPilotRegistry to Sepolia    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ── Config ─────────────────────────────────────────────
  const STETH_SEPOLIA = process.env.STETH_ADDRESS || "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af";
  const AGENT_ADDRESS = process.env.AGENT_WALLET || deployer.address;
  const DEFAULT_MAX_DAILY_BPS = 5000; // 50% of available yield per day

  console.log(`stETH:           ${STETH_SEPOLIA}`);
  console.log(`Agent:           ${AGENT_ADDRESS}`);
  console.log(`Default daily:   ${DEFAULT_MAX_DAILY_BPS} bps (${DEFAULT_MAX_DAILY_BPS / 100}%)\n`);

  // ── Deploy Registry ────────────────────────────────────
  console.log("Deploying YieldPilotRegistry...");

  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(
    STETH_SEPOLIA,
    AGENT_ADDRESS,
    DEFAULT_MAX_DAILY_BPS
  );

  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  console.log(`\n✅ Registry deployed at: ${registryAddress}`);
  console.log(`   tx: ${registry.deploymentTransaction()?.hash}`);

  // ── Add Uniswap Router as default target ──────────────
  console.log("\nAdding Uniswap Router as default target...");
  const UNISWAP_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  const addTx = await registry.addDefaultTarget(UNISWAP_ROUTER);
  await addTx.wait();
  console.log(`   ✓ Uniswap Router added: ${UNISWAP_ROUTER}`);

  // ── Summary ────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   ✅ Registry Deployment Complete!               ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`
  Add this to your .env:

    REGISTRY_CONTRACT=${registryAddress}

  How it works:
    1. Users approve stETH spending to the Registry address
    2. Users call createTreasuryAndDeposit(amount)
    3. Registry deploys a new Treasury per user
    4. Agent iterates all treasuries via getAllTreasuries()

  Verify on Etherscan:
    https://sepolia.etherscan.io/address/${registryAddress}
  `);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
