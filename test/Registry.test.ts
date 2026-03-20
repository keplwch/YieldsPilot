import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

/**
 * YieldPilotRegistry — Test Suite
 *
 * Tests the multi-user factory pattern: each user gets their own
 * Treasury, the agent is shared, and the registry tracks everything.
 */
describe("YieldPilotRegistry", function () {
  async function deployRegistryFixture() {
    const [admin, agent, user1, user2, user3, target1] =
      await ethers.getSigners();

    // Deploy mock stETH
    const MockERC20 = await ethers.getContractFactory("MockStETH");
    const stETH = await MockERC20.deploy();
    await stETH.waitForDeployment();

    // Mint stETH to users
    const mintAmount = ethers.parseEther("100");
    await stETH.mint(user1.address, mintAmount);
    await stETH.mint(user2.address, mintAmount);
    await stETH.mint(user3.address, mintAmount);

    // Deploy Registry
    const maxDailyBps = 5000; // 50%
    const Registry = await ethers.getContractFactory("YieldPilotRegistry");
    const registry = await Registry.connect(admin).deploy(
      await stETH.getAddress(),
      agent.address,
      maxDailyBps
    );
    await registry.waitForDeployment();

    // Add a default target (e.g., Uniswap router)
    await registry.connect(admin).addDefaultTarget(target1.address);

    return { registry, stETH, admin, agent, user1, user2, user3, target1, maxDailyBps };
  }

  // ── Deployment ──────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set correct admin, agent, and stETH", async function () {
      const { registry, stETH, admin, agent } = await loadFixture(deployRegistryFixture);
      expect(await registry.admin()).to.equal(admin.address);
      expect(await registry.agent()).to.equal(agent.address);
      expect(await registry.stETH()).to.equal(await stETH.getAddress());
    });

    it("should set default max daily bps", async function () {
      const { registry, maxDailyBps } = await loadFixture(deployRegistryFixture);
      expect(await registry.defaultMaxDailyBps()).to.equal(maxDailyBps);
    });

    it("should have default targets", async function () {
      const { registry, target1 } = await loadFixture(deployRegistryFixture);
      const targets = await registry.getDefaultTargets();
      expect(targets.length).to.equal(1);
      expect(targets[0]).to.equal(target1.address);
    });

    it("should start with 0 treasuries", async function () {
      const { registry } = await loadFixture(deployRegistryFixture);
      expect(await registry.treasuryCount()).to.equal(0);
    });
  });

  // ── Treasury Creation ───────────────────────────────────────────

  describe("Treasury Creation", function () {
    it("should create a treasury for user1", async function () {
      const { registry, stETH, user1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      // Approve registry
      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);

      // Create treasury
      await expect(registry.connect(user1).createTreasuryAndDeposit(depositAmount))
        .to.emit(registry, "TreasuryCreated");

      // Check registry state
      expect(await registry.treasuryCount()).to.equal(1);
      const treasuryAddr = await registry.userTreasury(user1.address);
      expect(treasuryAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("should deposit stETH into the new treasury", async function () {
      const { registry, stETH, user1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);

      // Check stETH balance in treasury
      expect(await stETH.balanceOf(treasuryAddr)).to.equal(depositAmount);
    });

    it("should set user as treasury owner", async function () {
      const { registry, stETH, user1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      expect(await treasury.owner()).to.equal(user1.address);
    });

    it("should set shared agent on new treasury", async function () {
      const { registry, stETH, user1, agent } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      expect(await treasury.agent()).to.equal(agent.address);
    });

    it("should whitelist default targets on new treasury", async function () {
      const { registry, stETH, user1, target1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      expect(await treasury.isAllowedTarget(target1.address)).to.be.true;
    });

    it("should revert if user already has a treasury", async function () {
      const { registry, stETH, user1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), ethers.parseEther("20"));
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      await expect(
        registry.connect(user1).createTreasuryAndDeposit(depositAmount)
      ).to.be.revertedWith("Registry: treasury exists");
    });

    it("should revert on zero deposit", async function () {
      const { registry, user1 } = await loadFixture(deployRegistryFixture);
      await expect(
        registry.connect(user1).createTreasuryAndDeposit(0)
      ).to.be.revertedWith("Registry: zero amount");
    });
  });

  // ── Multi-User ──────────────────────────────────────────────────

  describe("Multi-User", function () {
    it("should create separate treasuries for multiple users", async function () {
      const { registry, stETH, user1, user2, user3 } = await loadFixture(deployRegistryFixture);
      const amount = ethers.parseEther("10");

      // User1
      await stETH.connect(user1).approve(await registry.getAddress(), amount);
      await registry.connect(user1).createTreasuryAndDeposit(amount);

      // User2
      await stETH.connect(user2).approve(await registry.getAddress(), amount);
      await registry.connect(user2).createTreasuryAndDeposit(amount);

      // User3
      await stETH.connect(user3).approve(await registry.getAddress(), amount);
      await registry.connect(user3).createTreasuryAndDeposit(amount);

      expect(await registry.treasuryCount()).to.equal(3);

      // Each user has a different treasury
      const t1 = await registry.userTreasury(user1.address);
      const t2 = await registry.userTreasury(user2.address);
      const t3 = await registry.userTreasury(user3.address);

      expect(t1).to.not.equal(t2);
      expect(t2).to.not.equal(t3);
      expect(t1).to.not.equal(t3);
    });

    it("should return all treasuries via getAllTreasuries", async function () {
      const { registry, stETH, user1, user2 } = await loadFixture(deployRegistryFixture);
      const amount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), amount);
      await registry.connect(user1).createTreasuryAndDeposit(amount);

      await stETH.connect(user2).approve(await registry.getAddress(), amount);
      await registry.connect(user2).createTreasuryAndDeposit(amount);

      const all = await registry.getAllTreasuries();
      expect(all.length).to.equal(2);
    });

    it("should return user-treasury pairs", async function () {
      const { registry, stETH, user1, user2 } = await loadFixture(deployRegistryFixture);
      const amount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), amount);
      await registry.connect(user1).createTreasuryAndDeposit(amount);

      await stETH.connect(user2).approve(await registry.getAddress(), amount);
      await registry.connect(user2).createTreasuryAndDeposit(amount);

      const [users, treasuries] = await registry.getUserTreasuryPairs(0, 10);
      expect(users.length).to.equal(2);
      expect(treasuries.length).to.equal(2);
      expect(users[0]).to.equal(user1.address);
      expect(users[1]).to.equal(user2.address);
    });

    it("should support paginated getTreasuries", async function () {
      const { registry, stETH, user1, user2, user3 } = await loadFixture(deployRegistryFixture);
      const amount = ethers.parseEther("10");

      for (const user of [user1, user2, user3]) {
        await stETH.connect(user).approve(await registry.getAddress(), amount);
        await registry.connect(user).createTreasuryAndDeposit(amount);
      }

      const page1 = await registry.getTreasuries(0, 2);
      expect(page1.length).to.equal(2);

      const page2 = await registry.getTreasuries(2, 2);
      expect(page2.length).to.equal(1);
    });
  });

  // ── Agent Yield Spending Across Users ───────────────────────────

  describe("Agent Operations", function () {
    it("agent can spend yield from any user treasury", async function () {
      const { registry, stETH, user1, agent, target1 } = await loadFixture(deployRegistryFixture);
      const depositAmount = ethers.parseEther("10");

      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      // Simulate yield accrual by minting stETH directly to the treasury
      await stETH.mint(treasuryAddr, ethers.parseEther("1"));

      // Agent spends yield
      const yieldToSpend = ethers.parseEther("0.4");
      await treasury.connect(agent).spendYield(target1.address, yieldToSpend, "Test spend");

      expect(await stETH.balanceOf(target1.address)).to.equal(yieldToSpend);
    });
  });

  // ── Atomic Swap (swapYield) ──────────────────────────────────────

  describe("Atomic Swap (swapYield)", function () {
    async function deploySwapFixture() {
      const base = await loadFixture(deployRegistryFixture);
      const { registry, stETH, user1, agent, target1 } = base;

      // Deploy MockUSDC (output token)
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc = await MockUSDC.deploy();
      await usdc.waitForDeployment();

      // Deploy MockRouter with rate 2000e6 (2000 USDC per stETH)
      const MockRouter = await ethers.getContractFactory("MockRouter");
      const router = await MockRouter.deploy(ethers.parseUnits("2000", 6));
      await router.waitForDeployment();

      // Create user1's treasury
      const depositAmount = ethers.parseEther("10");
      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      // Add the mock router as an allowed target on the user's treasury
      await treasury.connect(user1).addTarget(await router.getAddress());

      // Simulate yield accrual: 1 stETH yield
      await stETH.mint(treasuryAddr, ethers.parseEther("1"));

      return { ...base, usdc, router, treasury, treasuryAddr };
    }

    it("should execute atomic swap without funds passing through agent", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      const amountIn = ethers.parseEther("0.4");
      const minAmountOut = ethers.parseUnits("700", 6); // conservative slippage

      // Build calldata: router.swap(stETH, amountIn, usdc, treasury)
      const routerAddr = await router.getAddress();
      const stETHAddr = await stETH.getAddress();
      const usdcAddr = await usdc.getAddress();

      const routerIface = new ethers.Interface([
        "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
      ]);
      const calldata = routerIface.encodeFunctionData("swap", [
        stETHAddr, amountIn, usdcAddr, treasuryAddr
      ]);

      // Agent calls swapYield — funds stay in treasury
      await treasury.connect(agent).swapYield(
        routerAddr, amountIn, calldata, usdcAddr, minAmountOut, "Swap stETH→USDC"
      );

      // Verify: USDC now in the treasury, NOT in agent wallet
      const treasuryUsdc = await usdc.balanceOf(treasuryAddr);
      expect(treasuryUsdc).to.equal(ethers.parseUnits("800", 6)); // 0.4 * 2000

      const agentUsdc = await usdc.balanceOf(agent.address);
      expect(agentUsdc).to.equal(0);
    });

    it("should emit YieldSwapped event", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      const amountIn = ethers.parseEther("0.2");
      const routerAddr = await router.getAddress();
      const stETHAddr = await stETH.getAddress();
      const usdcAddr = await usdc.getAddress();

      const routerIface = new ethers.Interface([
        "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
      ]);
      const calldata = routerIface.encodeFunctionData("swap", [
        stETHAddr, amountIn, usdcAddr, treasuryAddr
      ]);

      await expect(
        treasury.connect(agent).swapYield(
          routerAddr, amountIn, calldata, usdcAddr, 0, "Test swap"
        )
      ).to.emit(treasury, "YieldSwapped");
    });

    it("should revert if router is not in allowed targets", async function () {
      const { treasury, stETH, usdc, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      const fakeRouter = ethers.Wallet.createRandom().address;
      const amountIn = ethers.parseEther("0.1");

      await expect(
        treasury.connect(agent).swapYield(
          fakeRouter, amountIn, "0x", await usdc.getAddress(), 0, "bad"
        )
      ).to.be.revertedWith("YP: router not allowed");
    });

    it("should revert if swap output is below minAmountOut (slippage protection)", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      const amountIn = ethers.parseEther("0.1");
      const routerAddr = await router.getAddress();
      const stETHAddr = await stETH.getAddress();
      const usdcAddr = await usdc.getAddress();

      const routerIface = new ethers.Interface([
        "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
      ]);
      const calldata = routerIface.encodeFunctionData("swap", [
        stETHAddr, amountIn, usdcAddr, treasuryAddr
      ]);

      // Expect 200 USDC output but demand 500 → should revert
      const minAmountOut = ethers.parseUnits("500", 6);

      await expect(
        treasury.connect(agent).swapYield(
          routerAddr, amountIn, calldata, usdcAddr, minAmountOut, "greedy"
        )
      ).to.be.revertedWith("YP: insufficient output (slippage)");
    });

    it("should revert if amountIn exceeds available yield", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      // Try to swap 5 stETH but only 1 stETH yield available
      const amountIn = ethers.parseEther("5");
      const routerAddr = await router.getAddress();
      const usdcAddr = await usdc.getAddress();

      await expect(
        treasury.connect(agent).swapYield(
          routerAddr, amountIn, "0x", usdcAddr, 0, "too much"
        )
      ).to.be.revertedWith("YP: exceeds available yield");
    });

    it("should respect daily spend limits for swaps", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      // maxDailyBps = 5000 (50%), yield = 1 stETH → max = 0.5 stETH/day
      // Try to swap 0.6 stETH → should revert
      const amountIn = ethers.parseEther("0.6");
      const routerAddr = await router.getAddress();
      const stETHAddr = await stETH.getAddress();
      const usdcAddr = await usdc.getAddress();

      const routerIface = new ethers.Interface([
        "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
      ]);
      const calldata = routerIface.encodeFunctionData("swap", [
        stETHAddr, amountIn, usdcAddr, treasuryAddr
      ]);

      await expect(
        treasury.connect(agent).swapYield(
          routerAddr, amountIn, calldata, usdcAddr, 0, "over limit"
        )
      ).to.be.revertedWith("YP: exceeds daily limit");
    });

    it("should reset router approval to zero after swap", async function () {
      const { treasury, stETH, usdc, router, agent, treasuryAddr } =
        await loadFixture(deploySwapFixture);

      const amountIn = ethers.parseEther("0.2");
      const routerAddr = await router.getAddress();
      const stETHAddr = await stETH.getAddress();
      const usdcAddr = await usdc.getAddress();

      const routerIface = new ethers.Interface([
        "function swap(address tokenIn, uint256 amountIn, address tokenOut, address recipient) returns (uint256)"
      ]);
      const calldata = routerIface.encodeFunctionData("swap", [
        stETHAddr, amountIn, usdcAddr, treasuryAddr
      ]);

      await treasury.connect(agent).swapYield(
        routerAddr, amountIn, calldata, usdcAddr, 0, "clean approval"
      );

      // After swap, stETH allowance from treasury to router should be 0
      const remaining = await stETH.allowance(treasuryAddr, routerAddr);
      expect(remaining).to.equal(0);
    });

    it("non-agent cannot call swapYield", async function () {
      const { treasury, usdc, router, user1 } =
        await loadFixture(deploySwapFixture);

      await expect(
        treasury.connect(user1).swapYield(
          await router.getAddress(), 1, "0x", await usdc.getAddress(), 0, "nope"
        )
      ).to.be.revertedWith("YP: not agent");
    });
  });

  // ── withdrawToken ───────────────────────────────────────────────

  describe("withdrawToken", function () {
    it("agent can withdraw non-stETH tokens after swap", async function () {
      const base = await loadFixture(deployRegistryFixture);
      const { registry, stETH, user1, agent, target1 } = base;

      // Deploy MockUSDC
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc = await MockUSDC.deploy();
      await usdc.waitForDeployment();

      // Create treasury
      const depositAmount = ethers.parseEther("10");
      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      // Simulate: USDC sitting in treasury after a swap
      const usdcAmount = ethers.parseUnits("500", 6);
      await usdc.mint(treasuryAddr, usdcAmount);

      // Agent withdraws USDC to an allowed target
      await treasury.connect(agent).withdrawToken(
        await usdc.getAddress(), target1.address, usdcAmount
      );

      expect(await usdc.balanceOf(target1.address)).to.equal(usdcAmount);
    });

    it("cannot use withdrawToken for stETH", async function () {
      const base = await loadFixture(deployRegistryFixture);
      const { registry, stETH, user1, agent, target1 } = base;

      const depositAmount = ethers.parseEther("10");
      await stETH.connect(user1).approve(await registry.getAddress(), depositAmount);
      await registry.connect(user1).createTreasuryAndDeposit(depositAmount);

      const treasuryAddr = await registry.userTreasury(user1.address);
      const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
      const treasury = Treasury.attach(treasuryAddr);

      await expect(
        treasury.connect(agent).withdrawToken(
          await stETH.getAddress(), target1.address, ethers.parseEther("1")
        )
      ).to.be.revertedWith("YP: use spendYield for stETH");
    });
  });

  // ── Admin Controls ──────────────────────────────────────────────

  describe("Admin Controls", function () {
    it("admin can update agent", async function () {
      const { registry, admin, user1 } = await loadFixture(deployRegistryFixture);
      await registry.connect(admin).setAgent(user1.address);
      expect(await registry.agent()).to.equal(user1.address);
    });

    it("non-admin cannot update agent", async function () {
      const { registry, user1 } = await loadFixture(deployRegistryFixture);
      await expect(
        registry.connect(user1).setAgent(user1.address)
      ).to.be.revertedWith("Registry: not admin");
    });

    it("admin can pause registry", async function () {
      const { registry, admin, stETH, user1 } = await loadFixture(deployRegistryFixture);
      await registry.connect(admin).setPaused(true);

      const amount = ethers.parseEther("10");
      await stETH.connect(user1).approve(await registry.getAddress(), amount);

      await expect(
        registry.connect(user1).createTreasuryAndDeposit(amount)
      ).to.be.revertedWith("Registry: paused");
    });

    it("admin can transfer admin role", async function () {
      const { registry, admin, user1 } = await loadFixture(deployRegistryFixture);
      await registry.connect(admin).transferAdmin(user1.address);
      expect(await registry.admin()).to.equal(user1.address);
    });
  });
});
