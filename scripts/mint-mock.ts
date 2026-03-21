/**
 * Mint mock stETH or wstETH to any address (faucet for testing)
 *
 * Usage:
 *   # Drip 10 stETH to yourself (default)
 *   npx hardhat run scripts/mint-mock.ts --network sepolia
 *
 *   # Mint a custom amount to a specific address
 *   TO=0xYourAddress AMOUNT=50 npx hardhat run scripts/mint-mock.ts --network sepolia
 *
 *   # Mint wstETH instead of stETH
 *   TOKEN=wsteth npx hardhat run scripts/mint-mock.ts --network sepolia
 *
 *   # Mint 20 wstETH to a specific address
 *   TOKEN=wsteth TO=0xAddr AMOUNT=20 npx hardhat run scripts/mint-mock.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_STETH  = process.env.STETH_ADDRESS  || "";
const MOCK_WSTETH = process.env.WSTETH_ADDRESS || "";
const TOKEN       = (process.env.TOKEN || "steth").toLowerCase();

async function main() {
  const [deployer] = await ethers.getSigners();
  const to = process.env.TO || deployer.address;
  const amount = process.env.AMOUNT
    ? ethers.parseEther(process.env.AMOUNT)
    : ethers.parseEther("10");

  if (TOKEN === "wsteth") {
    // ── Mint wstETH ──────────────────────────────────────────
    if (!MOCK_WSTETH) {
      console.error("❌ WSTETH_ADDRESS not set in .env — deploy mocks first:\n   ./scripts/deploy.sh fresh");
      process.exit(1);
    }

    console.log(`MockWstETH: ${MOCK_WSTETH}`);
    console.log(`Minting:    ${ethers.formatEther(amount)} wstETH → ${to}\n`);

    const mockWstETH = await ethers.getContractAt("MockWstETH", MOCK_WSTETH);

    const before = await mockWstETH.balanceOf(to);
    const tx = await mockWstETH.mint(to, amount);
    await tx.wait();
    const after = await mockWstETH.balanceOf(to);

    console.log(`✅ Minted ${ethers.formatEther(amount)} wstETH`);
    console.log(`   Balance: ${ethers.formatEther(before)} → ${ethers.formatEther(after)} wstETH`);
    console.log(`   tx: ${tx.hash}`);
  } else {
    // ── Mint stETH (default) ─────────────────────────────────
    if (!MOCK_STETH) {
      console.error("❌ STETH_ADDRESS not set in .env — deploy mocks first:\n   ./scripts/deploy.sh fresh");
      process.exit(1);
    }

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

  console.log(`\n   Mint more:`);
  if (TOKEN === "wsteth") {
    console.log(`   TOKEN=wsteth AMOUNT=50 ./scripts/deploy.sh mint`);
  } else {
    console.log(`   AMOUNT=50 ./scripts/deploy.sh mint`);
    console.log(`   TOKEN=wsteth ./scripts/deploy.sh mint    # for wstETH`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
