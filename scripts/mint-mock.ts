/**
 * Mint mock stETH to any address (faucet for testing)
 *
 * Usage:
 *   # Drip 10 stETH to yourself (uses deployer wallet)
 *   npx hardhat run scripts/mint-mock.ts --network sepolia
 *
 *   # Mint a custom amount to a specific address
 *   TO=0xYourAddress AMOUNT=50 npx hardhat run scripts/mint-mock.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_STETH = process.env.STETH_ADDRESS || "";

async function main() {
  if (!MOCK_STETH) {
    console.error("❌ STETH_ADDRESS not set in .env — deploy mock first:\n   npx hardhat run scripts/deploy-mock.ts --network sepolia");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  const to = process.env.TO || deployer.address;
  const amount = process.env.AMOUNT ? ethers.parseEther(process.env.AMOUNT) : ethers.parseEther("10");

  console.log(`MockStETH: ${MOCK_STETH}`);
  console.log(`Minting:   ${ethers.formatEther(amount)} stETH → ${to}\n`);

  const mockStETH = await ethers.getContractAt("MockStETH", MOCK_STETH);

  const before = await mockStETH.balanceOf(to);
  const tx = await mockStETH.mint(to, amount);
  await tx.wait();
  const after = await mockStETH.balanceOf(to);

  console.log(`✅ Minted ${ethers.formatEther(amount)} stETH`);
  console.log(`   Balance: ${ethers.formatEther(before)} → ${ethers.formatEther(after)} stETH`);
  console.log(`   tx: ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
