import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * YieldsPilotTreasury - Comprehensive Test Suite
 *
 * Tests the yield-separation mechanism: principal stays locked,
 * only rebasing yield is spendable by the agent, with daily limits
 * and target whitelisting.
 */
describe("YieldsPilotTreasury", function () {
  // ── Fixture: deploys a mock stETH + Treasury ────────────────────
  async function deployTreasuryFixture() {
    const [owner, agent, target1, target2, stranger] =
      await ethers.getSigners();

    // Deploy a simple ERC20 mock to simulate stETH
    const MockERC20 = await ethers.getContractFactory("MockStETH");
    const stETH = await MockERC20.deploy();
    await stETH.waitForDeployment();

    // Deploy MockWstETH (wraps/unwraps stETH)
    const MockWstETH = await ethers.getContractFactory("MockWstETH");
    const wstETH = await MockWstETH.deploy(await stETH.getAddress());
    await wstETH.waitForDeployment();

    // Mint 100 stETH to owner for testing
    const mintAmount = ethers.parseEther("100");
    await stETH.mint(owner.address, mintAmount);

    // Deploy Treasury: 50% max daily spend
    const maxDailyBps = 5000;
    const Treasury = await ethers.getContractFactory("YieldsPilotTreasury");
    const treasury = await Treasury.deploy(
      await stETH.getAddress(),
      await wstETH.getAddress(),
      agent.address,
      maxDailyBps
    );
    await treasury.waitForDeployment();

    // Approve Treasury to spend owner's stETH
    await stETH
      .connect(owner)
      .approve(await treasury.getAddress(), ethers.MaxUint256);

    // Approve Treasury to spend owner's wstETH (for depositWstETH tests)
    await wstETH
      .connect(owner)
      .approve(await treasury.getAddress(), ethers.MaxUint256);

    // Add target1 as an allowed target
    await treasury.connect(owner).addTarget(target1.address);

    return { treasury, stETH, wstETH, owner, agent, target1, target2, stranger };
  }

  // ────────────────────────────────────────────────────────────────
  //  DEPLOYMENT
  // ────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the correct owner, agent, and stETH address", async function () {
      const { treasury, stETH, owner, agent } =
        await loadFixture(deployTreasuryFixture);

      expect(await treasury.owner()).to.equal(owner.address);
      expect(await treasury.agent()).to.equal(agent.address);
      expect(await treasury.stETH()).to.equal(await stETH.getAddress());
    });

    it("sets the correct maxDailySpendBps", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);
      expect(await treasury.maxDailySpendBps()).to.equal(5000);
    });

    it("starts unpaused with zero principal", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);
      expect(await treasury.paused()).to.equal(false);
      expect(await treasury.principal()).to.equal(0);
    });

    it("reverts on zero stETH address", async function () {
      const [, agent] = await ethers.getSigners();
      const { wstETH } = await loadFixture(deployTreasuryFixture);
      const Treasury = await ethers.getContractFactory("YieldsPilotTreasury");
      await expect(
        Treasury.deploy(ethers.ZeroAddress, await wstETH.getAddress(), agent.address, 5000)
      ).to.be.revertedWith("YP: zero stETH");
    });

    it("reverts on zero wstETH address", async function () {
      const [, agent] = await ethers.getSigners();
      const { stETH } = await loadFixture(deployTreasuryFixture);
      const Treasury = await ethers.getContractFactory("YieldsPilotTreasury");
      await expect(
        Treasury.deploy(await stETH.getAddress(), ethers.ZeroAddress, agent.address, 5000)
      ).to.be.revertedWith("YP: zero wstETH");
    });

    it("reverts on zero agent address", async function () {
      const { stETH, wstETH } = await loadFixture(deployTreasuryFixture);
      const Treasury = await ethers.getContractFactory("YieldsPilotTreasury");
      await expect(
        Treasury.deploy(await stETH.getAddress(), await wstETH.getAddress(), ethers.ZeroAddress, 5000)
      ).to.be.revertedWith("YP: zero agent");
    });

    it("reverts on bps > 10000", async function () {
      const [, agent] = await ethers.getSigners();
      const { stETH, wstETH } = await loadFixture(deployTreasuryFixture);
      const Treasury = await ethers.getContractFactory("YieldsPilotTreasury");
      await expect(
        Treasury.deploy(await stETH.getAddress(), await wstETH.getAddress(), agent.address, 10001)
      ).to.be.revertedWith("YP: bps > 100%");
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  DEPOSITS
  // ────────────────────────────────────────────────────────────────

  describe("Deposit", function () {
    it("owner can deposit stETH", async function () {
      const { treasury, stETH, owner } =
        await loadFixture(deployTreasuryFixture);

      const amount = ethers.parseEther("10");
      await expect(treasury.connect(owner).deposit(amount))
        .to.emit(treasury, "Deposited")
        .withArgs(owner.address, amount, amount);

      expect(await treasury.principal()).to.equal(amount);
      expect(await stETH.balanceOf(await treasury.getAddress())).to.equal(
        amount
      );
    });

    it("non-owner cannot deposit", async function () {
      const { treasury, stranger } =
        await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(stranger).deposit(ethers.parseEther("1"))
      ).to.be.revertedWith("YP: not owner");
    });

    it("cannot deposit zero", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);
      await expect(treasury.connect(owner).deposit(0)).to.be.revertedWith(
        "YP: zero amount"
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  YIELD ACCOUNTING
  // ────────────────────────────────────────────────────────────────

  describe("Yield Accounting", function () {
    it("availableYield is 0 when no yield has accrued", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      expect(await treasury.availableYield()).to.equal(0);
    });

    it("availableYield reflects rebasing gains", async function () {
      const { treasury, stETH, owner } =
        await loadFixture(deployTreasuryFixture);

      // Deposit 10 stETH
      await treasury.connect(owner).deposit(ethers.parseEther("10"));

      // Simulate stETH rebase: mint 0.5 stETH directly to treasury (mimics daily yield)
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("0.5")
      );

      expect(await treasury.availableYield()).to.equal(
        ethers.parseEther("0.5")
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  SPEND YIELD
  // ────────────────────────────────────────────────────────────────

  describe("spendYield", function () {
    it("agent can spend available yield to allowed target", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      // Deposit + simulate yield
      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      );

      const spendAmount = ethers.parseEther("0.4"); // within 50% daily limit of 1 ETH yield
      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, spendAmount, "Swap to WETH")
      )
        .to.emit(treasury, "YieldSpent")
        .withArgs(agent.address, target1.address, spendAmount, "Swap to WETH");

      expect(await stETH.balanceOf(target1.address)).to.equal(spendAmount);
    });

    it("agent cannot spend more than available yield", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("0.5")
      );

      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, ethers.parseEther("1"), "too much")
      ).to.be.revertedWith("YP: exceeds available yield");
    });

    it("agent cannot exceed daily spend limit", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("2")
      );

      // maxDailyBps = 5000 → 50% of 2 ETH yield = 1 ETH max per day
      // First spend: 0.8 ETH (ok)
      await treasury
        .connect(agent)
        .spendYield(target1.address, ethers.parseEther("0.8"), "swap1");

      // Second spend: 0.3 ETH → total 1.1 > 1.0 daily limit
      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, ethers.parseEther("0.3"), "swap2")
      ).to.be.revertedWith("YP: exceeds daily limit");
    });

    it("daily limit resets after 24 hours", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("2")
      );

      // Spend up to the limit
      await treasury
        .connect(agent)
        .spendYield(target1.address, ethers.parseEther("0.9"), "day1");

      // Advance 25 hours
      await time.increase(25 * 60 * 60);

      // Mint more yield to cover the new spend
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      );

      // Should succeed - new 24h window
      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, ethers.parseEther("0.5"), "day2")
      ).to.not.be.reverted;
    });

    it("reverts if target is not allowed", async function () {
      const { treasury, stETH, owner, agent, target2 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      );

      await expect(
        treasury
          .connect(agent)
          .spendYield(target2.address, ethers.parseEther("0.1"), "bad")
      ).to.be.revertedWith("YP: target not allowed");
    });

    it("non-agent cannot spend yield", async function () {
      const { treasury, stETH, owner, target1 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      );

      await expect(
        treasury
          .connect(owner)
          .spendYield(target1.address, ethers.parseEther("0.1"), "owner try")
      ).to.be.revertedWith("YP: not agent");
    });

    it("cannot spend when paused", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      );

      await treasury.connect(owner).setPaused(true);

      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, ethers.parseEther("0.1"), "paused")
      ).to.be.revertedWith("YP: paused");
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  OWNER CONTROLS
  // ────────────────────────────────────────────────────────────────

  describe("Owner Controls", function () {
    it("owner can withdraw principal", async function () {
      const { treasury, stETH, owner } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      const balBefore = await stETH.balanceOf(owner.address);

      await treasury.connect(owner).withdrawPrincipal(ethers.parseEther("5"));

      expect(await treasury.principal()).to.equal(ethers.parseEther("5"));
      expect(await stETH.balanceOf(owner.address)).to.equal(
        balBefore + ethers.parseEther("5")
      );
    });

    it("owner cannot withdraw more than principal", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));

      await expect(
        treasury.connect(owner).withdrawPrincipal(ethers.parseEther("11"))
      ).to.be.revertedWith("YP: exceeds principal");
    });

    it("emergency withdraw sends everything and pauses", async function () {
      const { treasury, stETH, owner } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).deposit(ethers.parseEther("10"));
      await stETH.mint(
        await treasury.getAddress(),
        ethers.parseEther("1")
      ); // simulate yield

      await treasury.connect(owner).emergencyWithdraw();

      expect(await treasury.principal()).to.equal(0);
      expect(await treasury.paused()).to.equal(true);
      expect(
        await stETH.balanceOf(await treasury.getAddress())
      ).to.equal(0);
    });

    it("owner can update agent", async function () {
      const { treasury, owner, stranger } =
        await loadFixture(deployTreasuryFixture);

      await expect(treasury.connect(owner).setAgent(stranger.address))
        .to.emit(treasury, "AgentUpdated");
      expect(await treasury.agent()).to.equal(stranger.address);
    });

    it("owner can add and remove targets", async function () {
      const { treasury, owner, target2 } =
        await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).addTarget(target2.address);
      expect(await treasury.isAllowedTarget(target2.address)).to.equal(true);

      await treasury.connect(owner).removeTarget(target2.address);
      expect(await treasury.isAllowedTarget(target2.address)).to.equal(false);
    });

    it("owner can update maxDailySpendBps", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      await expect(treasury.connect(owner).setMaxDailySpendBps(2500))
        .to.emit(treasury, "PermissionsUpdated")
        .withArgs(2500);
      expect(await treasury.maxDailySpendBps()).to.equal(2500);
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  PRINCIPAL PROTECTION (the critical safety test)
  // ────────────────────────────────────────────────────────────────

  describe("Principal Protection", function () {
    it("agent can NEVER touch principal - only yield", async function () {
      const { treasury, stETH, owner, agent, target1 } =
        await loadFixture(deployTreasuryFixture);

      const depositAmount = ethers.parseEther("50");
      await treasury.connect(owner).deposit(depositAmount);

      // No yield has accrued → agent should be able to spend 0
      expect(await treasury.availableYield()).to.equal(0);

      await expect(
        treasury
          .connect(agent)
          .spendYield(target1.address, ethers.parseEther("0.01"), "hack")
      ).to.be.revertedWith("YP: exceeds available yield");

      // Principal should be untouched
      expect(await treasury.principal()).to.equal(depositAmount);
      expect(
        await stETH.balanceOf(await treasury.getAddress())
      ).to.equal(depositAmount);
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  wstETH DEPOSIT & WITHDRAW
  // ────────────────────────────────────────────────────────────────

  describe("wstETH Support", function () {
    it("owner can deposit wstETH (unwraps to stETH internally)", async function () {
      const { treasury, stETH, wstETH, owner } =
        await loadFixture(deployTreasuryFixture);

      // Seed MockWstETH with stETH so unwrap() can return stETH
      await stETH.mint(await wstETH.getAddress(), ethers.parseEther("100"));

      // Give owner some wstETH via free mint (no stETH backing needed for mock)
      const wstETHAmount = ethers.parseEther("5");
      await wstETH.mint(owner.address, wstETHAmount);

      // Deposit wstETH into treasury
      await expect(treasury.connect(owner).depositWstETH(wstETHAmount))
        .to.emit(treasury, "DepositedWstETH");

      // Principal should increase by the stETH equivalent
      expect(await treasury.principal()).to.be.gt(0);

      // Treasury should hold stETH (wstETH was unwrapped)
      expect(await stETH.balanceOf(await treasury.getAddress())).to.be.gt(0);
    });

    it("owner can withdraw principal as wstETH", async function () {
      const { treasury, stETH, wstETH, owner } =
        await loadFixture(deployTreasuryFixture);

      // Deposit stETH normally
      const depositAmount = ethers.parseEther("10");
      await treasury.connect(owner).deposit(depositAmount);

      // Fund the wstETH contract with stETH so it can fulfil the wrap
      // (In real Lido, wstETH contract holds stETH; in mock we need to seed it)
      await stETH.mint(await wstETH.getAddress(), ethers.parseEther("20"));

      // Approve treasury to move stETH to wstETH contract for wrapping
      const treasuryAddr = await treasury.getAddress();
      await stETH.connect(owner).approve(treasuryAddr, ethers.MaxUint256);

      // Treasury needs to approve wstETH contract to pull stETH for wrapping
      // This is handled internally by the contract

      const wstETHBalBefore = await wstETH.balanceOf(owner.address);

      // Withdraw 5 stETH worth as wstETH
      const withdrawAmount = ethers.parseEther("5");
      await treasury.connect(owner).withdrawPrincipalAsWstETH(withdrawAmount);

      expect(await treasury.principal()).to.equal(depositAmount - withdrawAmount);
      expect(await wstETH.balanceOf(owner.address)).to.be.gt(wstETHBalBefore);
    });

    it("non-owner cannot deposit wstETH", async function () {
      const { treasury, stranger } =
        await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(stranger).depositWstETH(ethers.parseEther("1"))
      ).to.be.revertedWith("YP: not owner");
    });

    it("cannot deposit zero wstETH", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);
      await expect(
        treasury.connect(owner).depositWstETH(0)
      ).to.be.revertedWith("YP: zero amount");
    });
  });
});
