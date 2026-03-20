/**
 * Simulate stETH yield accrual by minting tokens directly into a treasury.
 *
 * On mainnet, stETH rebases automatically as Lido distributes staking rewards.
 * For testing, this script mints mock stETH into your treasury contract so
 * availableYield() = balance - principal grows, giving the agent something to act on.
 *
 * Usage:
 *   # Simulate 0.1 stETH yield into your treasury
 *   TREASURY=0xYourTreasuryAddress npx hardhat run scripts/simulate-yield.ts --network sepolia
 *
 *   # Custom amount
 *   TREASURY=0x... YIELD=0.5 npx hardhat run scripts/simulate-yield.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_STETH = process.env.STETH_ADDRESS || "";
const TREASURY = process.env.TREASURY || "";
const YIELD_AMOUNT = process.env.YIELD || "0.1";

async function main() {
  if (!MOCK_STETH) {
    console.error("❌ STETH_ADDRESS not set in .env");
    process.exit(1);
  }
  if (!TREASURY) {
    console.error("❌ TREASURY env var required — set it to your treasury contract address");
    console.error("   Find it on the dashboard under Treasury Overview, or in the UserList");
    process.exit(1);
  }

  const amount = ethers.parseEther(YIELD_AMOUNT);

  console.log(`MockStETH: ${MOCK_STETH}`);
  console.log(`Treasury:  ${TREASURY}`);
  console.log(`Yield:     +${YIELD_AMOUNT} stETH\n`);

  const mockStETH = await ethers.getContractAt("MockStETH", MOCK_STETH);

  // Read treasury state before
  const treasuryAbi = [
    "function principal() view returns (uint256)",
    "function availableYield() view returns (uint256)",
    "function totalBalance() view returns (uint256)",
  ];
  const treasury = new ethers.Contract(TREASURY, treasuryAbi, ethers.provider);

  const principalBefore = await treasury.principal();
  const yieldBefore = await treasury.availableYield();
  const balanceBefore = await treasury.totalBalance();

  console.log("Before:");
  console.log(`  principal:      ${ethers.formatEther(principalBefore)} stETH`);
  console.log(`  availableYield: ${ethers.formatEther(yieldBefore)} stETH`);
  console.log(`  totalBalance:   ${ethers.formatEther(balanceBefore)} stETH\n`);

  // Simulate yield by minting directly to treasury
  const tx = await mockStETH.simulateYield(TREASURY, amount);
  await tx.wait();

  const yieldAfter = await treasury.availableYield();
  const balanceAfter = await treasury.totalBalance();

  console.log("After:");
  console.log(`  availableYield: ${ethers.formatEther(yieldAfter)} stETH  (+${YIELD_AMOUNT})`);
  console.log(`  totalBalance:   ${ethers.formatEther(balanceAfter)} stETH`);
  console.log(`\n✅ Yield simulated — agent will pick this up on next cycle`);
  console.log(`   tx: ${tx.hash}`);
  console.log(`\n   Run again to accumulate more yield:`);
  console.log(`   TREASURY=${TREASURY} YIELD=0.5 npx hardhat run scripts/simulate-yield.ts --network sepolia`);
}

main().catch((e) => { console.error(e); process.exit(1); });
