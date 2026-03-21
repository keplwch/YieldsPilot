/**
 * YieldsPilot - Mainnet Fork Swap Test
 *
 * Proves the full swapYield flow works against REAL Uniswap V3 on a
 * forked mainnet. No mocks, no fakes - actual Lido stETH → wstETH → Uniswap V3.
 *
 * Why the helper? stETH is a rebasing token with virtually no Uniswap V3 pool
 * liquidity. All V3 pools use wstETH. In production, the Uniswap Trading API
 * handles the wrapping automatically. This test uses a thin ForkSwapHelper
 * contract that wraps stETH → wstETH before swapping on V3.
 *
 * Run with:
 *   FORK_RPC=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY npx hardhat test test/fork-swap.test.ts
 *
 * Or via deploy.sh:
 *   FORK_RPC=https://... ./deploy.sh fork:test
 */

import { expect } from "chai";
import { ethers } from "hardhat";

// ── Mainnet addresses ─────────────────────────────────────────────────────────
const STETH          = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const WSTETH         = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const WETH           = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC           = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const V3_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const UNI_ROUTER     = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

// wstETH/WETH pool exists at 0.01% fee with deep liquidity on mainnet
const FEE_LOWEST = 100;

// Lido ABI
const LIDO_ABI = [
  "function submit(address _referral) external payable returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

async function mintStETH(signer: any, amountETH: bigint): Promise<bigint> {
  const lido = new ethers.Contract(STETH, LIDO_ABI, signer);
  const balBefore = await lido.balanceOf(signer.address);
  await lido.submit(ethers.ZeroAddress, { value: amountETH });
  const balAfter = await lido.balanceOf(signer.address);
  return balAfter - balBefore;
}

describe("Mainnet Fork - Real Uniswap Swap", function () {
  this.timeout(180_000);

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (Number(chainId) !== 1 && Number(chainId) !== 31337) {
      console.log("  ⚠ Skipping fork tests - not on mainnet fork");
      this.skip();
    }
    const code = await ethers.provider.getCode(STETH);
    if (code === "0x") {
      console.log("  ⚠ Skipping - stETH not found (run with FORK_RPC)");
      this.skip();
    }
  });

  it("should swap stETH yield → WETH via real Uniswap V3 (wstETH/WETH pool)", async function () {
    const [deployer] = await ethers.getSigners();

    console.log("\n  ╔══════════════════════════════════════════════════════════╗");
    console.log("  ║  🧪 Mainnet Fork - Real Uniswap V3 Swap Test            ║");
    console.log("  ╚══════════════════════════════════════════════════════════╝\n");

    const steth = new ethers.Contract(STETH, LIDO_ABI, deployer);
    const weth  = await ethers.getContractAt("IERC20", WETH);

    // ── Step 1: Deploy ForkSwapHelper ─────────────────────────────────
    console.log("  📦 Step 1: Deploying contracts...");
    const Helper = await ethers.getContractFactory("ForkSwapHelper");
    const helper = await Helper.deploy(STETH, WSTETH, V3_SWAP_ROUTER, WETH);
    await helper.waitForDeployment();
    const helperAddr = await helper.getAddress();
    console.log(`     SwapHelper: ${helperAddr}`);

    // ── Step 2: Deploy Registry with helper as allowed target ─────────
    const Registry = await ethers.getContractFactory("YieldsPilotRegistry");
    const registry = await Registry.deploy(STETH, WSTETH, deployer.address, 5000);
    await registry.waitForDeployment();
    const registryAddr = await registry.getAddress();

    // Add the swap helper as allowed target
    await registry.addDefaultTarget(helperAddr);
    console.log(`     Registry:   ${registryAddr}`);
    console.log(`     ✅ SwapHelper added as allowed target`);

    // ── Step 3: Mint stETH via Lido ───────────────────────────────────
    console.log("\n  💰 Step 2: Minting stETH via Lido submit()...");
    const stethMinted = await mintStETH(deployer, ethers.parseEther("15"));
    console.log(`     Received: ${ethers.formatEther(stethMinted)} stETH`);

    // ── Step 4: Create Treasury with 10 stETH ─────────────────────────
    console.log("\n  🏦 Step 3: Creating Treasury with 10 stETH...");
    await steth.approve(registryAddr, ethers.parseEther("10"));
    await registry.connect(deployer).createTreasuryAndDeposit(ethers.parseEther("10"));

    const treasuryAddr = await registry.userTreasury(deployer.address);
    const treasury = await ethers.getContractAt("YieldsPilotTreasury", treasuryAddr);
    const principal = await treasury.principal();
    console.log(`     Treasury:  ${treasuryAddr}`);
    console.log(`     Principal: ${ethers.formatEther(principal)} stETH`);

    // ── Step 5: Inject yield ──────────────────────────────────────────
    console.log("\n  📈 Step 4: Simulating yield (sending extra stETH)...");
    await steth.transfer(treasuryAddr, ethers.parseEther("3"));
    const availYield = await treasury.availableYield();
    console.log(`     Available yield: ${ethers.formatEther(availYield)} stETH`);

    // ── Step 6: Build swap calldata ───────────────────────────────────
    console.log("\n  🔄 Step 5: Building swap calldata...");
    const swapAmount = ethers.parseEther("0.5");

    // Encode call to ForkSwapHelper.swapStETHViaWstETH()
    const helperIface = new ethers.Interface([
      "function swapStETHViaWstETH(uint256 stETHAmount, uint24 fee, address tokenOut, uint256 minOut) external returns (uint256)",
    ]);
    const swapCalldata = helperIface.encodeFunctionData("swapStETHViaWstETH", [
      swapAmount,
      FEE_LOWEST,  // 0.01% wstETH/WETH pool
      WETH,
      0,           // minOut (checked by treasury contract separately)
    ]);

    console.log(`     Swap:       ${ethers.formatEther(swapAmount)} stETH → wstETH → WETH`);
    console.log(`     Pool:       wstETH/WETH (0.01% fee)`);
    console.log(`     Helper:     ${helperAddr}`);

    // ── Step 7: Execute swapYield ─────────────────────────────────────
    console.log("\n  ⚡ Step 6: Executing swapYield on Treasury...");
    const wethBefore = await weth.balanceOf(treasuryAddr);
    console.log(`     WETH before: ${ethers.formatEther(wethBefore)}`);

    const tx = await treasury.connect(deployer).swapYield(
      helperAddr,     // "router" = our swap helper
      swapAmount,
      swapCalldata,
      WETH,           // tokenOut
      1,              // minAmountOut = 1 wei (test only)
      "fork-test: stETH → wstETH → WETH via Uniswap V3"
    );

    const receipt = await tx.wait();
    console.log(`     ✅ TX confirmed in block ${receipt!.blockNumber}`);
    console.log(`     Gas used:  ${receipt!.gasUsed.toString()}`);

    const wethAfter = await weth.balanceOf(treasuryAddr);
    const wethReceived = wethAfter - wethBefore;
    console.log(`     WETH after:    ${ethers.formatEther(wethAfter)}`);
    console.log(`     WETH received: ${ethers.formatEther(wethReceived)}`);

    expect(wethReceived).to.be.gt(0, "Should have received WETH from swap");

    // ── Step 8: Verify state ──────────────────────────────────────────
    console.log("\n  ✅ Step 7: Verifying final state...");
    const finalPrincipal = await treasury.principal();
    const finalYield = await treasury.availableYield();
    const yieldWithdrawn = await treasury.yieldWithdrawn();

    console.log(`     Principal (unchanged): ${ethers.formatEther(finalPrincipal)} stETH`);
    console.log(`     Remaining yield:       ${ethers.formatEther(finalYield)} stETH`);
    console.log(`     Yield withdrawn:       ${ethers.formatEther(yieldWithdrawn)} stETH`);
    console.log(`     WETH in treasury:      ${ethers.formatEther(wethAfter)}`);

    expect(finalPrincipal).to.equal(principal, "Principal must be unchanged");
    expect(yieldWithdrawn).to.equal(swapAmount, "yieldWithdrawn must track swap");

    const rate = Number(ethers.formatEther(wethReceived)) / Number(ethers.formatEther(swapAmount));

    console.log("\n  ╔══════════════════════════════════════════════════════════╗");
    console.log("  ║  ✅ FORK TEST PASSED                                     ║");
    console.log("  ║                                                           ║");
    console.log(`  ║  Swapped ${ethers.formatEther(swapAmount)} stETH → ${ethers.formatEther(wethReceived).padStart(18)} WETH      ║`);
    console.log(`  ║  Rate: 1 stETH ≈ ${rate.toFixed(6)} WETH                       ║`);
    console.log("  ║  via real Uniswap V3 wstETH/WETH pool on forked mainnet  ║");
    console.log("  ║  Principal untouched ✓  Yield tracked ✓  WETH received ✓ ║");
    console.log("  ╚══════════════════════════════════════════════════════════╝\n");
  });

  it("should reject swap that exceeds daily spend limit", async function () {
    const [deployer] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("YieldsPilotRegistry");
    const registry = await Registry.deploy(STETH, WSTETH, deployer.address, 1000); // 10%
    await registry.waitForDeployment();
    await registry.addDefaultTarget(UNI_ROUTER);

    const steth = new ethers.Contract(STETH, LIDO_ABI, deployer);
    await mintStETH(deployer, ethers.parseEther("15"));

    await steth.approve(await registry.getAddress(), ethers.parseEther("10"));
    await registry.connect(deployer).createTreasuryAndDeposit(ethers.parseEther("10"));

    const treasuryAddr = await registry.userTreasury(deployer.address);
    const treasury = await ethers.getContractAt("YieldsPilotTreasury", treasuryAddr);
    await steth.transfer(treasuryAddr, ethers.parseEther("2"));

    const availYield = await treasury.availableYield();
    console.log(`     Available yield: ${ethers.formatEther(availYield)} stETH`);
    console.log(`     Daily limit: 10% = ${ethers.formatEther(availYield * 1000n / 10000n)} stETH`);

    await expect(
      treasury.connect(deployer).swapYield(
        UNI_ROUTER, availYield, "0x00", WETH, 0, "should-fail"
      )
    ).to.be.revertedWith("YP: exceeds daily limit");

    console.log("     ✅ Daily limit correctly enforced");
  });

  it("should reject swap from non-agent address", async function () {
    const [deployer, attacker] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("YieldsPilotRegistry");
    const registry = await Registry.deploy(STETH, WSTETH, deployer.address, 5000);
    await registry.waitForDeployment();
    await registry.addDefaultTarget(UNI_ROUTER);

    const steth = new ethers.Contract(STETH, LIDO_ABI, deployer);
    await mintStETH(deployer, ethers.parseEther("8"));
    await steth.approve(await registry.getAddress(), ethers.parseEther("5"));
    await registry.connect(deployer).createTreasuryAndDeposit(ethers.parseEther("5"));

    const treasuryAddr = await registry.userTreasury(deployer.address);
    const treasury = await ethers.getContractAt("YieldsPilotTreasury", treasuryAddr);
    await steth.transfer(treasuryAddr, ethers.parseEther("1"));

    await expect(
      treasury.connect(attacker).swapYield(
        UNI_ROUTER, ethers.parseEther("0.1"), "0x00", WETH, 0, "hacker"
      )
    ).to.be.revertedWith("YP: not agent");

    console.log("     ✅ Non-agent correctly rejected");
  });

  it("should reject swap to disallowed router", async function () {
    const [deployer] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("YieldsPilotRegistry");
    const registry = await Registry.deploy(STETH, WSTETH, deployer.address, 5000);
    await registry.waitForDeployment();

    const steth = new ethers.Contract(STETH, LIDO_ABI, deployer);
    await mintStETH(deployer, ethers.parseEther("8"));
    await steth.approve(await registry.getAddress(), ethers.parseEther("5"));
    await registry.connect(deployer).createTreasuryAndDeposit(ethers.parseEther("5"));

    const treasuryAddr = await registry.userTreasury(deployer.address);
    const treasury = await ethers.getContractAt("YieldsPilotTreasury", treasuryAddr);
    await steth.transfer(treasuryAddr, ethers.parseEther("1"));

    await expect(
      treasury.connect(deployer).swapYield(
        V3_SWAP_ROUTER, ethers.parseEther("0.1"), "0x00", WETH, 0, "no-target"
      )
    ).to.be.revertedWith("YP: router not allowed");

    console.log("     ✅ Disallowed router correctly rejected");
  });
});
