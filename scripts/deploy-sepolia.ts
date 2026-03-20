/**
 * Deploy YieldPilotTreasury to Ethereum Sepolia
 *
 * This is the PRIMARY deployment for:
 *   - Lido "stETH Agent Treasury" ($3,000)
 *   - Lido "Vault Position Monitor" ($1,500)
 *   - Lido "Lido MCP" ($5,000)
 *   - Uniswap "Agentic Finance" ($5,000)
 *   - Protocol Labs "Let the Agent Cook" ($8,000)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-sepolia.ts --network sepolia
 */

import { ethers } from "hardhat";

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🛫 Deploying YieldPilotTreasury to Sepolia    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ── Sepolia stETH address ──────────────────────────────
  // NOTE: On Sepolia, Lido has a test deployment.
  // If no official testnet stETH, we deploy a mock ERC20 for testing.
  // On mainnet, use: 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84

  const STETH_SEPOLIA = process.env.STETH_ADDRESS || "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af"; // Lido Sepolia stETH
  const AGENT_ADDRESS = process.env.AGENT_WALLET || deployer.address; // Agent wallet
  const MAX_DAILY_BPS = 5000; // 50% of available yield per day

  console.log(`stETH:     ${STETH_SEPOLIA}`);
  console.log(`Agent:     ${AGENT_ADDRESS}`);
  console.log(`Max daily: ${MAX_DAILY_BPS} bps (${MAX_DAILY_BPS / 100}%)\n`);

  // ── Deploy ─────────────────────────────────────────────
  console.log("Deploying YieldPilotTreasury...");

  const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
  const treasury = await Treasury.deploy(
    STETH_SEPOLIA,
    AGENT_ADDRESS,
    MAX_DAILY_BPS
  );

  await treasury.waitForDeployment();
  const address = await treasury.getAddress();

  console.log(`\n✅ Treasury deployed at: ${address}`);
  console.log(`   tx: ${treasury.deploymentTransaction()?.hash}`);

  // ── Post-deploy: Add Uniswap router as allowed target ──
  console.log("\nAdding Uniswap Router as allowed target...");
  const UNISWAP_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  const addTx = await treasury.addTarget(UNISWAP_ROUTER);
  await addTx.wait();
  console.log(`   ✓ Uniswap Router whitelisted: ${UNISWAP_ROUTER}`);

  // ── Summary ────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   ✅ Deployment Complete!                        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`
  Add this to your .env:

    TREASURY_CONTRACT=${address}

  Next steps:
    1. Approve stETH spending:
       stETH.approve("${address}", amount)

    2. Deposit principal:
       treasury.deposit(amount)

    3. Start the agent:
       ./dev.sh agent

  Verify on Etherscan:
    https://sepolia.etherscan.io/address/${address}
  `);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
