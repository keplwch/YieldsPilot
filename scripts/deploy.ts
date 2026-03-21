/**
 * YieldPilot — Unified Deploy Script
 *
 * All deployment logic lives here. Controlled via DEPLOY_CMD env var,
 * set automatically by deploy.sh. Do not call this directly — use deploy.sh.
 *
 * ─── Commands ────────────────────────────────────────────────────────────────
 *
 *  fresh      Full first-time setup: MockUSDC + MockRouter + Registry
 *             → This is the recommended starting point for any new environment.
 *             → Prints a ready-to-paste .env block and saves deploy-manifest.json.
 *
 *  registry   Deploy the Registry only (multi-user treasury factory).
 *             → Use if you already have mocks deployed and want to redeploy the
 *               Registry, or if you're on a network with real stETH.
 *
 *  treasury   Deploy a single-user Treasury directly (no Registry).
 *             → Use for simple single-wallet setups or integration testing.
 *             → Requires STETH_ADDRESS and WSTETH_ADDRESS in .env.
 *
 *  mocks      Deploy MockUSDC + MockRouter only (no Registry or Treasury).
 *             → Use when you need to redeploy the testnet swap infrastructure
 *               without touching the Registry.
 *             → NOTE: MockStETH and MockWstETH are NOT deployed here because
 *               Lido provides real testnet contracts on Sepolia (see STETH_ADDRESS
 *               and WSTETH_ADDRESS). The mock contracts exist for Hardhat unit tests only.
 *
 *  mainnet    Deploy Registry to Ethereum Mainnet with real Lido stETH/wstETH.
 *             → No mocks deployed — uses real Uniswap Router as default target.
 *             → Point RPC_URL at a mainnet endpoint and fund the deployer wallet.
 *
 *  status     Deploy to Status Network Sepolia (gasless transactions, chainId=2020).
 *             → Deploys a simple Treasury for the "Go Gasless" bounty proof.
 *
 *  verify     Verify a deployed contract on Etherscan.
 *             → Set VERIFY_ADDRESS, VERIFY_CONTRACT, and ETHERSCAN_API_KEY in .env.
 *
 * ─── Environment Variables ───────────────────────────────────────────────────
 *
 *  Required for all deployments:
 *    AGENT_PRIVATE_KEY      Deployer wallet private key (hex, with 0x prefix)
 *    RPC_URL                Ethereum Sepolia RPC endpoint
 *
 *  Contract addresses (defaults to Lido Sepolia testnet addresses):
 *    STETH_ADDRESS          stETH contract address
 *                           Default: 0x6df25A1734E181AFbBD9c8A50b1D00e39D482704 (Sepolia)
 *    WSTETH_ADDRESS         wstETH contract address
 *                           Default: 0xB82381A3fBD3FaFA77B3a7bE693342AA3d14232a (Sepolia)
 *    AGENT_WALLET           Agent wallet address (defaults to deployer address)
 *
 *  Set by `fresh` deploy — paste into .env after running:
 *    REGISTRY_CONTRACT      Deployed Registry address
 *    MOCK_ROUTER_ADDRESS    Deployed MockRouter address
 *    MOCK_TOKEN_OUT_ADDRESS Deployed MockUSDC address
 *
 *  For verification (verify command only):
 *    VERIFY_ADDRESS         Contract address to verify on Etherscan
 *    VERIFY_CONTRACT        Contract name, e.g. "YieldPilotRegistry"
 *    ETHERSCAN_API_KEY      Etherscan API key
 *
 * ─── First-Time Setup ────────────────────────────────────────────────────────
 *
 *  1. Fill in .env:  AGENT_PRIVATE_KEY, RPC_URL (Sepolia)
 *  2. Run:           ./deploy.sh fresh
 *  3. Paste the printed .env block into your .env file
 *  4. Restart agent: bun run agent
 *  5. Open frontend, connect wallet, deposit stETH → creates your Treasury
 *  6. Agent auto-discovers your Treasury via Registry and starts managing yield
 *
 * ─── Redeployment ────────────────────────────────────────────────────────────
 *
 *  Just the Registry (keep existing mocks):
 *    ./deploy.sh registry
 *    → Update REGISTRY_CONTRACT in .env
 *
 *  Everything from scratch (new testnet env):
 *    ./deploy.sh fresh
 *    → Paste the full .env block printed at the end
 *
 *  Single Treasury (single-user mode):
 *    ./deploy.sh treasury
 *    → Update TREASURY_CONTRACT in .env
 */

import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

// ─── Shared constants ─────────────────────────────────────────────────────────

// Sepolia testnet defaults (Lido + Uniswap deployments on Sepolia)
const STETH_SEPOLIA_DEFAULT  = "0x6df25A1734E181AFbBD9c8A50b1D00e39D482704";
const WSTETH_SEPOLIA_DEFAULT = "0xB82381A3fBD3FaFA77B3a7bE693342AA3d14232a";

// Ethereum Mainnet addresses (Lido + Uniswap production contracts)
const STETH_MAINNET  = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const WSTETH_MAINNET = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

// Uniswap Universal Router (same address on both Sepolia and Mainnet)
const UNISWAP_ROUTER         = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

const DEFAULT_MAX_DAILY_BPS  = 5000; // 50% of available yield per day
const MOCK_ROUTER_RATE       = "2000"; // USDC per stETH

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

function envVal(key: string, fallback: string = ""): string {
  return process.env[key] || fallback;
}

async function deployerInfo() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:   chainId ${network.chainId}`);

  if (balance === 0n) {
    console.error("\n❌ Deployer has zero balance. Fund the wallet first (Sepolia faucet).");
    process.exit(1);
  }

  return { deployer, balance, network };
}

function saveManifest(data: Record<string, unknown>) {
  const p = path.resolve(process.cwd(), "deploy-manifest.json");
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`\n  📄 Manifest saved → deploy-manifest.json`);
}

// ─── fresh ────────────────────────────────────────────────────────────────────
//  Full first-time setup: MockUSDC + MockRouter + Registry + default targets
// ─────────────────────────────────────────────────────────────────────────────

async function cmdFresh() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🚀 YieldPilot — Fresh Full Deploy                     ║");
  console.log("║   MockUSDC + MockRouter + Registry                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  const STETH   = envVal("STETH_ADDRESS",  STETH_SEPOLIA_DEFAULT);
  const WSTETH  = envVal("WSTETH_ADDRESS", WSTETH_SEPOLIA_DEFAULT);
  const AGENT   = envVal("AGENT_WALLET",   deployer.address);

  console.log(`\n  Config:`);
  console.log(`    stETH:        ${STETH}`);
  console.log(`    wstETH:       ${WSTETH}`);
  console.log(`    Agent:        ${AGENT}`);
  console.log(`    Daily limit:  ${DEFAULT_MAX_DAILY_BPS} bps (${DEFAULT_MAX_DAILY_BPS / 100}%)`);
  console.log(`    Swap rate:    ${MOCK_ROUTER_RATE} USDC / stETH`);

  // Step 1 — MockUSDC
  sep("Step 1/4: Deploying MockUSDC");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC:    ${usdcAddress}`);
  console.log(`     tx: ${usdc.deploymentTransaction()?.hash}`);

  // Step 2 — MockRouter
  sep("Step 2/4: Deploying MockRouter");
  const rate = ethers.parseUnits(MOCK_ROUTER_RATE, 6); // 6 decimals (USDC)
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(rate);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`  ✅ MockRouter:  ${routerAddress}`);
  console.log(`     Rate: ${MOCK_ROUTER_RATE} USDC per stETH`);
  console.log(`     tx: ${router.deploymentTransaction()?.hash}`);

  // Step 3 — Registry
  sep("Step 3/4: Deploying YieldPilotRegistry");
  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(STETH, WSTETH, AGENT, DEFAULT_MAX_DAILY_BPS);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  ✅ Registry:    ${registryAddress}`);
  console.log(`     tx: ${registry.deploymentTransaction()?.hash}`);

  // Step 4 — Default targets
  sep("Step 4/4: Configuring default targets");
  const tx1 = await registry.addDefaultTarget(UNISWAP_ROUTER);
  await tx1.wait();
  console.log(`  ✅ Uniswap Router added: ${UNISWAP_ROUTER}`);

  const tx2 = await registry.addDefaultTarget(routerAddress);
  await tx2.wait();
  console.log(`  ✅ MockRouter added:     ${routerAddress}`);

  const targets = await registry.getDefaultTargets();
  console.log(`\n  Default targets (${targets.length}):`);
  for (const t of targets) console.log(`    • ${t}`);

  // Output
  const envBlock = [
    `# ═══ YieldPilot Deploy — ${new Date().toISOString()} ═══`,
    `REGISTRY_CONTRACT=${registryAddress}`,
    `MOCK_ROUTER_ADDRESS=${routerAddress}`,
    `MOCK_TOKEN_OUT_ADDRESS=${usdcAddress}`,
    `STETH_ADDRESS=${STETH}`,
    `WSTETH_ADDRESS=${WSTETH}`,
  ].join("\n");

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ✅ FULL DEPLOYMENT COMPLETE                           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`
  ┌──────────────────┬──────────────────────────────────────────────┐
  │ MockUSDC         │ ${usdcAddress} │
  │ MockRouter       │ ${routerAddress} │
  │ Registry         │ ${registryAddress} │
  └──────────────────┴──────────────────────────────────────────────┘

  ━━━ Paste into .env ━━━

${envBlock}

  ━━━ Next steps ━━━

  1. Paste the .env block above into your .env
  2. Restart the agent:  bun run agent
  3. Open the frontend, connect wallet, deposit stETH
  4. Agent uses swapYield() via MockRouter — real atomic swaps on testnet!

  ━━━ How testnet swaps work ━━━

  Agent detects testnet + MOCK_ROUTER_ADDRESS is set →
  Builds MockRouter.swap() calldata →
  Calls treasury.swapYield(mockRouter, amount, calldata, usdc, 0, reason) →
  Treasury approves MockRouter → MockRouter pulls stETH, mints USDC →
  USDC lands back in Treasury (funds never leave the contract)
`);

  saveManifest({
    command: "fresh",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: { mockUSDC: usdcAddress, mockRouter: routerAddress, registry: registryAddress },
    config: { stETH: STETH, wstETH: WSTETH, agent: AGENT, uniswapRouter: UNISWAP_ROUTER, maxDailyBps: DEFAULT_MAX_DAILY_BPS },
    defaultTargets: targets.map((t: string) => t),
    envBlock,
  });
}

// ─── registry ─────────────────────────────────────────────────────────────────
//  Deploy Registry only — use when mocks already exist or on real stETH network
// ─────────────────────────────────────────────────────────────────────────────

async function cmdRegistry() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🏭 Deploying YieldPilotRegistry                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  const STETH  = envVal("STETH_ADDRESS",  STETH_SEPOLIA_DEFAULT);
  const WSTETH = envVal("WSTETH_ADDRESS", WSTETH_SEPOLIA_DEFAULT);
  const AGENT  = envVal("AGENT_WALLET",   deployer.address);

  console.log(`\n  stETH:         ${STETH}`);
  console.log(`  wstETH:        ${WSTETH}`);
  console.log(`  Agent:         ${AGENT}`);
  console.log(`  Daily limit:   ${DEFAULT_MAX_DAILY_BPS} bps (${DEFAULT_MAX_DAILY_BPS / 100}%)\n`);

  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(STETH, WSTETH, AGENT, DEFAULT_MAX_DAILY_BPS);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  ✅ Registry deployed: ${registryAddress}`);
  console.log(`     tx: ${registry.deploymentTransaction()?.hash}`);

  // Add Uniswap Router as default target
  const tx = await registry.addDefaultTarget(UNISWAP_ROUTER);
  await tx.wait();
  console.log(`  ✅ Uniswap Router added as default target`);

  // If MockRouter is already deployed, add it too
  const MOCK_ROUTER = envVal("MOCK_ROUTER_ADDRESS");
  if (MOCK_ROUTER) {
    const tx2 = await registry.addDefaultTarget(MOCK_ROUTER);
    await tx2.wait();
    console.log(`  ✅ MockRouter added as default target: ${MOCK_ROUTER}`);
  }

  console.log(`
  ━━━ Update .env ━━━

  REGISTRY_CONTRACT=${registryAddress}

  ━━━ Next steps ━━━

  1. Update REGISTRY_CONTRACT in .env
  2. Restart agent:  bun run agent
  3. Users deposit stETH via the frontend to create their Treasuries
  4. Agent auto-discovers all Treasuries via getAllTreasuries()
  `);

  saveManifest({
    command: "registry",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: { registry: registryAddress },
    config: { stETH: STETH, wstETH: WSTETH, agent: AGENT },
  });
}

// ─── treasury ─────────────────────────────────────────────────────────────────
//  Deploy a single-user Treasury directly (no Registry, no mocks required)
// ─────────────────────────────────────────────────────────────────────────────

async function cmdTreasury() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🏦 Deploying YieldPilotTreasury (single-user)         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  const STETH  = envVal("STETH_ADDRESS",  STETH_SEPOLIA_DEFAULT);
  const WSTETH = envVal("WSTETH_ADDRESS", WSTETH_SEPOLIA_DEFAULT);
  const AGENT  = envVal("AGENT_WALLET",   deployer.address);

  console.log(`\n  stETH:        ${STETH}`);
  console.log(`  wstETH:       ${WSTETH}`);
  console.log(`  Agent:        ${AGENT}`);
  console.log(`  Daily limit:  ${DEFAULT_MAX_DAILY_BPS} bps (${DEFAULT_MAX_DAILY_BPS / 100}%)\n`);

  const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
  const treasury = await Treasury.deploy(STETH, WSTETH, AGENT, DEFAULT_MAX_DAILY_BPS);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log(`  ✅ Treasury deployed: ${treasuryAddress}`);
  console.log(`     tx: ${treasury.deploymentTransaction()?.hash}`);

  // Add Uniswap Router as allowed target
  const tx = await treasury.addTarget(UNISWAP_ROUTER);
  await tx.wait();
  console.log(`  ✅ Uniswap Router whitelisted`);

  // If MockRouter is set, add it too
  const MOCK_ROUTER = envVal("MOCK_ROUTER_ADDRESS");
  if (MOCK_ROUTER) {
    const tx2 = await treasury.addTarget(MOCK_ROUTER);
    await tx2.wait();
    console.log(`  ✅ MockRouter whitelisted: ${MOCK_ROUTER}`);
  }

  console.log(`
  ━━━ Update .env ━━━

  TREASURY_CONTRACT=${treasuryAddress}

  ━━━ Next steps ━━━

  1. Update TREASURY_CONTRACT in .env
  2. Approve stETH:  stETH.approve("${treasuryAddress}", amount)
  3. Deposit:        treasury.deposit(amount)
  4. Restart agent:  bun run agent

  Verify on Etherscan:
    https://sepolia.etherscan.io/address/${treasuryAddress}
  `);

  saveManifest({
    command: "treasury",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: { treasury: treasuryAddress },
    config: { stETH: STETH, wstETH: WSTETH, agent: AGENT },
  });
}

// ─── mocks ────────────────────────────────────────────────────────────────────
//  Deploy MockUSDC + MockRouter only (no Registry)
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMocks() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🧪 Deploying MockUSDC + MockRouter                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  sep("Deploying MockUSDC");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC:   ${usdcAddress}`);
  console.log(`     tx: ${usdc.deploymentTransaction()?.hash}`);

  sep("Deploying MockRouter");
  const rate = ethers.parseUnits(MOCK_ROUTER_RATE, 6);
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(rate);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`  ✅ MockRouter: ${routerAddress}`);
  console.log(`     Rate: ${MOCK_ROUTER_RATE} USDC per stETH`);
  console.log(`     tx: ${router.deploymentTransaction()?.hash}`);

  console.log(`
  ━━━ Update .env ━━━

  MOCK_ROUTER_ADDRESS=${routerAddress}
  MOCK_TOKEN_OUT_ADDRESS=${usdcAddress}

  ━━━ Next steps ━━━

  Add MockRouter as an allowed target on each Treasury:
    treasury.addTarget("${routerAddress}")

  Or redeploy the Registry to pick it up as a default target:
    ./deploy.sh registry
  `);

  saveManifest({
    command: "mocks",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: { mockUSDC: usdcAddress, mockRouter: routerAddress },
  });
}

// ─── mocks-all ───────────────────────────────────────────────────────────────
//  Deploy ALL mocks: MockStETH + MockWstETH + MockUSDC + MockRouter
//  Use when you want fully self-contained testing with mintable stETH/wstETH
//  (instead of relying on Lido's Sepolia testnet contracts)
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMocksAll() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🧪 Deploying ALL Mocks                                ║");
  console.log("║   MockStETH + MockWstETH + MockUSDC + MockRouter        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  // Step 1 — MockStETH
  sep("Step 1/4: Deploying MockStETH");
  const MockStETH = await ethers.getContractFactory("MockStETH");
  const stETH = await MockStETH.deploy();
  await stETH.waitForDeployment();
  const stETHAddress = await stETH.getAddress();
  console.log(`  ✅ MockStETH:   ${stETHAddress}`);
  console.log(`     tx: ${stETH.deploymentTransaction()?.hash}`);
  console.log(`     Faucet: drip(address) gives 10 stETH per call`);
  console.log(`     Free mint: mint(address, amount)`);

  // Step 2 — MockWstETH
  sep("Step 2/4: Deploying MockWstETH");
  const MockWstETH = await ethers.getContractFactory("MockWstETH");
  const wstETH = await MockWstETH.deploy(stETHAddress);
  await wstETH.waitForDeployment();
  const wstETHAddress = await wstETH.getAddress();
  console.log(`  ✅ MockWstETH:  ${wstETHAddress}`);
  console.log(`     tx: ${wstETH.deploymentTransaction()?.hash}`);
  console.log(`     Faucet: drip(address) gives 10 wstETH per call`);
  console.log(`     Wrap/unwrap: wrap(stETHAmount) / unwrap(wstETHAmount)`);
  console.log(`     Rate: 1 wstETH = 1.15 stETH (configurable via setRate)`);

  // Seed MockWstETH with stETH so wrap/unwrap works
  const seedAmount = ethers.parseEther("10000");
  const seedTx = await stETH.mint(wstETHAddress, seedAmount);
  await seedTx.wait();
  console.log(`  ✅ Seeded MockWstETH with ${ethers.formatEther(seedAmount)} stETH for wrap/unwrap`);

  // Step 3 — MockUSDC
  sep("Step 3/4: Deploying MockUSDC");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  ✅ MockUSDC:    ${usdcAddress}`);
  console.log(`     tx: ${usdc.deploymentTransaction()?.hash}`);

  // Step 4 — MockRouter
  sep("Step 4/4: Deploying MockRouter");
  const rate = ethers.parseUnits(MOCK_ROUTER_RATE, 6);
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const router = await MockRouter.deploy(rate);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`  ✅ MockRouter:  ${routerAddress}`);
  console.log(`     Rate: ${MOCK_ROUTER_RATE} USDC per stETH`);
  console.log(`     tx: ${router.deploymentTransaction()?.hash}`);

  const envBlock = [
    `# ═══ YieldPilot Mocks-All Deploy — ${new Date().toISOString()} ═══`,
    `STETH_ADDRESS=${stETHAddress}`,
    `WSTETH_ADDRESS=${wstETHAddress}`,
    `MOCK_ROUTER_ADDRESS=${routerAddress}`,
    `MOCK_TOKEN_OUT_ADDRESS=${usdcAddress}`,
  ].join("\n");

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ✅ ALL MOCKS DEPLOYED                                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`
  ┌──────────────────┬──────────────────────────────────────────────┐
  │ MockStETH        │ ${stETHAddress} │
  │ MockWstETH       │ ${wstETHAddress} │
  │ MockUSDC         │ ${usdcAddress} │
  │ MockRouter       │ ${routerAddress} │
  └──────────────────┴──────────────────────────────────────────────┘

  ━━━ Paste into .env ━━━

${envBlock}

  ━━━ Next steps ━━━

  1. Paste the .env block above into your .env
  2. Deploy the Registry:  ./deploy.sh registry
  3. Mint stETH:  ./deploy.sh mint
  4. Mint wstETH: TOKEN=wsteth ./deploy.sh mint
  5. Simulate yield: TREASURY=0x... ./deploy.sh simulate:yield

  ━━━ How mock stETH/wstETH work ━━━

  MockStETH:  ERC20 with free mint() and drip() faucet
              simulateYield(treasury, amount) mints directly to treasury
  MockWstETH: Wraps/unwraps MockStETH with configurable exchange rate
              setRate(1.2e18) sets 1 wstETH = 1.2 stETH
`);

  saveManifest({
    command: "mocks-all",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: Number((await ethers.provider.getNetwork()).chainId),
    contracts: { mockStETH: stETHAddress, mockWstETH: wstETHAddress, mockUSDC: usdcAddress, mockRouter: routerAddress },
    envBlock,
  });
}

// ─── status ───────────────────────────────────────────────────────────────────
//  Deploy to Status Network Sepolia (gasless, chainId=2020)
// ─────────────────────────────────────────────────────────────────────────────

async function cmdStatus() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🛫 Deploying to Status Network Sepolia                ║");
  console.log("║   Gasless transactions (chainId=2020)                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer } = await deployerInfo();

  // Status Network has gasPrice=0, so we deploy a simple Treasury as proof
  // stETH doesn't exist on Status — use a placeholder address for the bounty
  const STETH  = envVal("STETH_ADDRESS",  deployer.address); // placeholder on Status
  const WSTETH = envVal("WSTETH_ADDRESS", deployer.address); // placeholder on Status
  const AGENT  = deployer.address;

  console.log("\n  Deploying YieldPilotTreasury...");
  const Treasury = await ethers.getContractFactory("YieldPilotTreasury");
  const treasury = await Treasury.deploy(STETH, WSTETH, AGENT, DEFAULT_MAX_DAILY_BPS);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  const deployTx = treasury.deploymentTransaction();
  console.log(`  ✅ Contract deployed: ${treasuryAddress}`);
  console.log(`     Deploy tx (gasless!): ${deployTx?.hash}`);

  // Execute a gasless write transaction as proof
  console.log("\n  Executing gasless transaction...");
  const setPauseTx = await treasury.setPaused(false);
  const receipt = await setPauseTx.wait();
  console.log(`  ✅ Gasless tx:  ${receipt?.hash}`);
  console.log(`     Block:       ${receipt?.blockNumber}`);
  console.log(`     Gas used:    ${receipt?.gasUsed.toString()} (gas price = 0)`);

  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║   ✅ Status Network Bounty Proof                        ║
  ╚══════════════════════════════════════════════════════════╝

  Contract:   ${treasuryAddress}
  Deploy TX:  ${deployTx?.hash}
  Gasless TX: ${receipt?.hash}
  Chain:      Status Network Sepolia (chainId=2020)
  Explorer:   https://sepoliascan.status.im/address/${treasuryAddress}

  Save these hashes for your submission!
  `);

  saveManifest({
    command: "status",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: 2020,
    contracts: { treasury: treasuryAddress },
    proof: { deployTx: deployTx?.hash, gaslessTx: receipt?.hash },
  });
}

// ─── mainnet ─────────────────────────────────────────────────────────────────
//  Deploy Registry to Ethereum Mainnet with real Lido stETH/wstETH
//  NO mock contracts — only the Registry + Uniswap Router as default target
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMainnet() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   🚀 YieldPilot — MAINNET Deploy                        ║");
  console.log("║   Registry + Uniswap Router (real Lido stETH/wstETH)    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const { deployer, network } = await deployerInfo();

  // Safety check: ensure we're on mainnet
  if (Number(network.chainId) !== 1) {
    console.error(`\n❌ Expected chainId=1 (Ethereum Mainnet), got chainId=${network.chainId}`);
    console.error("   Make sure RPC_URL points to a mainnet endpoint and you're using --network mainnet.\n");
    process.exit(1);
  }

  const STETH  = envVal("STETH_ADDRESS",  STETH_MAINNET);
  const WSTETH = envVal("WSTETH_ADDRESS", WSTETH_MAINNET);
  const AGENT  = envVal("AGENT_WALLET",   deployer.address);
  const BPS    = Number(envVal("MAX_DAILY_BPS", String(DEFAULT_MAX_DAILY_BPS)));

  console.log(`\n  Config:`);
  console.log(`    stETH:        ${STETH}`);
  console.log(`    wstETH:       ${WSTETH}`);
  console.log(`    Agent:        ${AGENT}`);
  console.log(`    Daily limit:  ${BPS} bps (${BPS / 100}%)`);
  console.log(`    Chain:        Ethereum Mainnet (chainId=1)`);

  console.log("\n  ⚠️  THIS IS A MAINNET DEPLOYMENT — REAL ETH WILL BE SPENT");
  console.log("  ⚠️  Double-check all addresses above before proceeding\n");

  // Step 1 — Registry
  sep("Step 1/2: Deploying YieldPilotRegistry");
  const Registry = await ethers.getContractFactory("YieldPilotRegistry");
  const registry = await Registry.deploy(STETH, WSTETH, AGENT, BPS);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  ✅ Registry:    ${registryAddress}`);
  console.log(`     tx: ${registry.deploymentTransaction()?.hash}`);

  // Step 2 — Default targets (Uniswap Router only, no mocks on mainnet)
  sep("Step 2/2: Configuring default target (Uniswap Router)");
  const tx1 = await registry.addDefaultTarget(UNISWAP_ROUTER);
  await tx1.wait();
  console.log(`  ✅ Uniswap Router added: ${UNISWAP_ROUTER}`);

  const targets = await registry.getDefaultTargets();
  console.log(`\n  Default targets (${targets.length}):`);
  for (const t of targets) console.log(`    • ${t}`);

  const envBlock = [
    `# ═══ YieldPilot MAINNET Deploy — ${new Date().toISOString()} ═══`,
    `REGISTRY_CONTRACT=${registryAddress}`,
    `STETH_ADDRESS=${STETH}`,
    `WSTETH_ADDRESS=${WSTETH}`,
  ].join("\n");

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ✅ MAINNET DEPLOYMENT COMPLETE                        ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`
  ┌──────────────────┬──────────────────────────────────────────────┐
  │ Registry         │ ${registryAddress} │
  └──────────────────┴──────────────────────────────────────────────┘

  ━━━ Paste into .env ━━━

${envBlock}

  ━━━ Next steps ━━━

  1. Paste the .env block above into your .env
  2. Set VITE_NETWORK=mainnet in frontend .env
  3. RPC_URL should already point to mainnet (used for this deploy)
  4. Restart the agent:  bun run agent
  5. Open the frontend, connect wallet, deposit stETH
  6. Agent uses Uniswap V3 for real yield swaps on mainnet

  ━━━ Verify on Etherscan ━━━

  npx hardhat verify --network mainnet ${registryAddress} ${STETH} ${WSTETH} ${AGENT} ${BPS}

  https://etherscan.io/address/${registryAddress}
`);

  saveManifest({
    command: "mainnet",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: 1,
    contracts: { registry: registryAddress },
    config: { stETH: STETH, wstETH: WSTETH, agent: AGENT, uniswapRouter: UNISWAP_ROUTER, maxDailyBps: BPS },
    defaultTargets: targets.map((t: string) => t),
    envBlock,
  });
}

// ─── verify ───────────────────────────────────────────────────────────────────
//  Prints the hardhat verify command — actual verification is run by deploy.sh
//  (hardhat verify can't be called programmatically in all setups)
// ─────────────────────────────────────────────────────────────────────────────

async function cmdVerify() {
  const address = envVal("VERIFY_ADDRESS");
  const contractName = envVal("VERIFY_CONTRACT", "YieldPilotRegistry");

  if (!address) {
    console.error("❌ VERIFY_ADDRESS not set. Usage: VERIFY_ADDRESS=0x... ./deploy.sh verify");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  const STETH  = envVal("STETH_ADDRESS",  STETH_SEPOLIA_DEFAULT);
  const WSTETH = envVal("WSTETH_ADDRESS", WSTETH_SEPOLIA_DEFAULT);
  const AGENT  = envVal("AGENT_WALLET",   deployer.address);

  // Determine constructor args based on contract type
  let constructorArgs: string[];
  if (contractName === "YieldPilotRegistry" || contractName === "YieldPilotTreasury") {
    constructorArgs = [STETH, WSTETH, AGENT, String(DEFAULT_MAX_DAILY_BPS)];
  } else {
    constructorArgs = []; // MockUSDC, MockRouter have simple constructors
  }

  console.log(`  Contract:          ${contractName}`);
  console.log(`  Address:           ${address}`);
  console.log(`  Constructor args:  ${constructorArgs.join(", ") || "(none)"}`);
  console.log(`\n  Run:`);
  console.log(`  npx hardhat verify --network sepolia ${address} ${constructorArgs.join(" ")}`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, () => Promise<void>> = {
  fresh:      cmdFresh,
  registry:   cmdRegistry,
  treasury:   cmdTreasury,
  mocks:      cmdMocks,
  "mocks-all": cmdMocksAll,
  mainnet:    cmdMainnet,
  status:     cmdStatus,
  verify:     cmdVerify,
};

async function main() {
  const cmd = process.env.DEPLOY_CMD;

  if (!cmd || !(cmd in COMMANDS)) {
    console.error(`\n❌ DEPLOY_CMD not set or unknown. Valid values: ${Object.keys(COMMANDS).join(", ")}\n`);
    console.error("   Use deploy.sh to run deployments:\n");
    console.error("   ./deploy.sh fresh         Full setup (recommended first time)");
    console.error("   ./deploy.sh registry      Registry only");
    console.error("   ./deploy.sh treasury      Single Treasury");
    console.error("   ./deploy.sh mocks         MockUSDC + MockRouter");
    console.error("   ./deploy.sh mocks-all     MockStETH + MockWstETH + MockUSDC + MockRouter");
    console.error("   ./deploy.sh mainnet       Production deploy to Ethereum Mainnet");
    console.error("   ./deploy.sh status        Status Network Sepolia");
    console.error("   ./deploy.sh verify        Verify on Etherscan\n");
    process.exit(1);
  }

  await COMMANDS[cmd]();
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err.message || err);
  process.exit(1);
});
