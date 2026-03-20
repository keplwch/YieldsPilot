/**
 * Deploy a simple contract to Status Network Sepolia
 *
 * BONUS bounty: Status Network "Go Gasless" ($2,000 split)
 * Requirements:
 *   ✓ Deploy smart contract on Status Network Sepolia
 *   ✓ Execute at least one gasless transaction
 *   ✓ Include tx hash proof
 *   ✓ Include AI agent component (our whole project)
 *   ✓ README or short video demo
 *
 * Usage:
 *   npx hardhat run scripts/deploy-status.ts --network statusSepolia
 */

import { ethers } from "hardhat";

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🛫 Deploying to Status Network Sepolia        ║");
  console.log("║   Bounty: Go Gasless ($2,000 split)             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Deploy the same Treasury contract (or a lightweight version)
  // The bounty just needs: contract + gasless tx + proof
  console.log("\nDeploying YieldPilotTreasury...");

  // Use a mock stETH address for Status Network (it's just for the bounty proof)
  const MOCK_STETH = deployer.address; // placeholder
  const AGENT = deployer.address;
  const MAX_BPS = 5000;

  const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
  const treasury = await Treasury.deploy(MOCK_STETH, AGENT, MAX_BPS);

  await treasury.waitForDeployment();
  const address = await treasury.getAddress();
  const deployTx = treasury.deploymentTransaction();

  console.log(`\n✅ Contract deployed at: ${address}`);
  console.log(`   Deploy tx (gasless!): ${deployTx?.hash}`);

  // Execute a gasless transaction (read + write)
  console.log("\nExecuting gasless transaction...");
  const setPauseTx = await treasury.setPaused(false);
  const receipt = await setPauseTx.wait();

  console.log(`   ✓ Gasless tx: ${receipt?.hash}`);
  console.log(`   Block: ${receipt?.blockNumber}`);
  console.log(`   Gas used: ${receipt?.gasUsed.toString()} (but gas price = 0!)`);

  // ── Proof output ───────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   ✅ Status Network Bounty Proof                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`
  Contract:    ${address}
  Deploy TX:   ${deployTx?.hash}
  Gasless TX:  ${receipt?.hash}
  Chain:       Status Network Sepolia (2020)
  Explorer:    https://sepoliascan.status.im/address/${address}

  Save these tx hashes for your submission!
  `);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
