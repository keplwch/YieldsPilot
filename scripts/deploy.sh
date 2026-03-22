#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  YieldsPilot - Deploy Script                                                ║
# ║                                                                              ║
# ║  All deployment logic lives in scripts/deploy.ts - this script provides     ║
# ║  the CLI interface, pre-flight checks, and Etherscan verification.           ║
# ║                                                                              ║
# ║  ─── Commands ─────────────────────────────────────────────────────────── ║
# ║                                                                              ║
# ║    ./deploy.sh fresh            ⭐ Full setup (start here)                  ║
# ║                                    Deploys MockUSDC + MockRouter + Registry  ║
# ║                                    Prints ready-to-paste .env block          ║
# ║                                                                              ║
# ║    ./deploy.sh registry         Deploy Registry only                         ║
# ║                                    Multi-user treasury factory                ║
# ║                                    Use when mocks already exist               ║
# ║                                                                              ║
# ║    ./deploy.sh treasury         Deploy single-user Treasury directly          ║
# ║                                    No Registry needed                         ║
# ║                                    Good for simple / integration testing      ║
# ║                                                                              ║
# ║    ./deploy.sh mocks            Deploy MockUSDC + MockRouter only             ║
# ║                                    Use to redeploy testnet swap infra         ║
# ║                                    without touching the Registry              ║
# ║                                                                              ║
# ║    ./deploy.sh mocks-all        Deploy ALL mocks (stETH + wstETH + USDC +   ║
# ║                                    MockRouter). Use for fully self-contained  ║
# ║                                    testing with mintable stETH/wstETH         ║
# ║                                                                              ║
# ║    ./deploy.sh mainnet          Deploy Registry to Ethereum Mainnet          ║
# ║                                    Real Lido stETH/wstETH, no mocks          ║
# ║                                    Point RPC_URL at mainnet endpoint         ║
# ║                                                                              ║
# ║    ./deploy.sh status           Deploy to Status Network Sepolia              ║
# ║                                    Gasless transactions (chainId=2020)        ║
# ║                                                                              ║
# ║    ./deploy.sh verify <addr>    Verify contract on Etherscan                  ║
# ║                                    Requires ETHERSCAN_API_KEY in .env         ║
# ║                                                                              ║
# ║  ─── Testing (Sepolia) ─────────────────────────────────────────────────── ║
# ║                                                                              ║
# ║    ./deploy.sh mint             Mint mock stETH or wstETH to a wallet        ║
# ║                                    TOKEN=wsteth TO=0x... AMOUNT=10           ║
# ║                                                                              ║
# ║    ./deploy.sh simulate:yield   Simulate yield accrual into a treasury       ║
# ║                                    TREASURY=0x... [YIELD=0.1]                ║
# ║                                                                              ║
# ║    ./deploy.sh fork:test       Test real Uniswap swap on forked mainnet     ║
# ║                                    FORK_RPC=<mainnet-rpc> (zero gas cost)    ║
# ║                                                                              ║
# ║  ─── Other ─────────────────────────────────────────────────────────────── ║
# ║                                                                              ║
# ║    ./deploy.sh compile          Compile Solidity contracts                   ║
# ║    ./deploy.sh test             Run all 60 contract tests                    ║
# ║    ./deploy.sh history          Show deployment history                      ║
# ║    ./deploy.sh help             Show this message                            ║
# ║                                                                              ║
# ║  ─── First-Time Setup ─────────────────────────────────────────────────── ║
# ║                                                                              ║
# ║    1. Copy .env.example → .env                                               ║
# ║    2. Fill in AGENT_PRIVATE_KEY and RPC_URL                                  ║
# ║    3. Run:  ./deploy.sh fresh                                                 ║
# ║    4. Paste the printed .env block into your .env                             ║
# ║    5. Restart agent:  bun run agent                                          ║
# ║    6. Open frontend, connect wallet, deposit stETH                           ║
# ║                                                                              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
DEPLOY_LOG="$ROOT_DIR/.deploy_log"

# ── Colors ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }

banner() {
  echo -e "${PURPLE}${BOLD}"
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║     🚀 YieldsPilot Deployer           ║"
  echo "  ╚══════════════════════════════════════╝"
  echo -e "${NC}"
}

# ── Pre-flight checks ──────────────────────────────────────────────────────────

preflight() {
  log "Pre-flight checks..."

  # Node.js >= 18
  if ! command -v node &>/dev/null; then
    fail "Node.js not found - install from https://nodejs.org"
  fi
  local ver
  ver=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$ver" -lt 18 ]; then
    fail "Node.js >= 18 required (found $(node -v))"
  fi
  ok "Node $(node -v)"

  # Dependencies
  if [ ! -d "node_modules" ]; then
    warn "node_modules missing - installing..."
    bun install
  fi
  ok "Dependencies"

  # .env
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f ".env.example" ]; then
      cp .env.example .env
      warn ".env created from .env.example"
      fail "Fill in AGENT_PRIVATE_KEY and RPC_URL in .env, then re-run"
    else
      fail ".env not found and no .env.example to copy from"
    fi
  fi
  ok ".env found"

  # Source env
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

  # Private key
  local key="${AGENT_PRIVATE_KEY:-}"
  if [ -z "$key" ] || [ "$key" = "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then
    fail "AGENT_PRIVATE_KEY not set in .env"
  fi
  ok "Private key set"

  # RPC URL (warn only - hardhat has a built-in default)
  local rpc="${RPC_URL:-}"
  if [ -z "$rpc" ] || [[ "$rpc" == *"YOUR_KEY"* ]]; then
    warn "RPC_URL not set - deployment may fail or be rate-limited"
    warn "Get a free key at: https://alchemy.com"
  else
    ok "RPC URL: ${rpc:0:45}..."
  fi

  echo ""
}

# ── Compile ────────────────────────────────────────────────────────────────────

cmd_compile() {
  banner
  log "Compiling contracts..."
  npx hardhat compile
  ok "Compilation successful"
}

# ── Test ───────────────────────────────────────────────────────────────────────

cmd_test() {
  banner
  log "Running contract tests..."
  npx hardhat test
}

# ── Deploy commands (delegate to deploy.ts) ────────────────────────────────────

run_deploy() {
  local cmd="$1"
  local network="${2:-sepolia}"

  preflight

  log "Compiling contracts..."
  npx hardhat compile --quiet
  echo ""

  DEPLOY_CMD="$cmd" npx hardhat run scripts/deploy.ts --network "$network"
}

cmd_fresh()     { banner; run_deploy "fresh"     "${1:-sepolia}"; }
cmd_registry()  { banner; run_deploy "registry"  "${1:-sepolia}"; }
cmd_treasury()  { banner; run_deploy "treasury"  "${1:-sepolia}"; }
cmd_mocks()     { banner; run_deploy "mocks"     "${1:-sepolia}"; }
cmd_mocks_all() { banner; run_deploy "mocks-all" "${1:-sepolia}"; }
cmd_mainnet()   { banner; run_deploy "mainnet"   "mainnet"; }
cmd_status()    { banner; run_deploy "status"    "statusSepolia"; }

# ── Verify ─────────────────────────────────────────────────────────────────────

cmd_verify() {
  local address="${1:-}"
  if [ -z "$address" ]; then
    fail "Usage: ./deploy.sh verify <contract-address> [ContractName]"
  fi

  local contract_name="${2:-YieldsPilotRegistry}"

  preflight
  banner

  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

  if [ -z "${ETHERSCAN_API_KEY:-}" ]; then
    fail "ETHERSCAN_API_KEY not set in .env"
  fi

  local verify_network="${3:-sepolia}"

  # Select defaults based on network
  local steth wsteth
  if [ "$verify_network" = "mainnet" ]; then
    steth="${STETH_ADDRESS:-0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84}"
    wsteth="${WSTETH_ADDRESS:-0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0}"
  else
    steth="${STETH_ADDRESS:-0x6df25A1734E181AFbBD9c8A50b1D00e39D482704}"
    wsteth="${WSTETH_ADDRESS:-0xB82381A3fBD3FaFA77B3a7bE693342AA3d14232a}"
  fi
  local agent="${AGENT_WALLET:-}"

  # Derive agent address from private key if not set
  if [ -z "$agent" ]; then
    agent=$(node -e "
      const { ethers } = require('ethers');
      const w = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
      process.stdout.write(w.address);
    " 2>/dev/null) || fail "Could not derive agent address - set AGENT_WALLET in .env"
  fi

  log "Verifying ${contract_name} at ${address}..."
  log "Constructor args: stETH=${steth}, wstETH=${wsteth}, agent=${agent}, bps=5000"
  echo ""

  npx hardhat verify --network "$verify_network" "$address" "$steth" "$wsteth" "$agent" "5000"

  ok "Verified!"
  if [ "$verify_network" = "mainnet" ]; then
    echo -e "\n  View: ${CYAN}https://etherscan.io/address/${address}#code${NC}\n"
  else
    echo -e "\n  View: ${CYAN}https://sepolia.etherscan.io/address/${address}#code${NC}\n"
  fi
}

# ── History ────────────────────────────────────────────────────────────────────

cmd_history() {
  banner
  echo -e "  ${BOLD}Deployment History${NC}\n"

  if [ ! -f "$DEPLOY_LOG" ] && [ ! -f "deploy-manifest.json" ]; then
    warn "No deployments recorded yet. Run ./deploy.sh fresh to get started."
    return
  fi

  if [ -f "deploy-manifest.json" ]; then
    echo -e "  ${BOLD}Latest manifest (deploy-manifest.json):${NC}"
    echo ""
    node -e "
      const m = JSON.parse(require('fs').readFileSync('deploy-manifest.json', 'utf8'));
      console.log('  Command:   ' + m.command);
      console.log('  Timestamp: ' + m.timestamp);
      console.log('  Network:   chainId ' + m.network);
      console.log('  Deployer:  ' + m.deployer);
      console.log('');
      console.log('  Contracts:');
      for (const [k, v] of Object.entries(m.contracts || {})) {
        console.log('    ' + String(k).padEnd(16) + v);
      }
    " 2>/dev/null || warn "Could not parse deploy-manifest.json"
    echo ""
  fi

  if [ -f "$DEPLOY_LOG" ]; then
    echo -e "  ${BOLD}Log entries (.deploy_log):${NC}"
    echo ""
    cat "$DEPLOY_LOG"
    echo ""
  fi
}

# ── Mint mock tokens ──────────────────────────────────────────────────────────

cmd_mint() {
  banner
  preflight

  log "Minting mock tokens..."
  npx hardhat run scripts/mint-mock.ts --network sepolia
}

# ── Fork test (mainnet fork - real Uniswap swap) ─────────────────────────────

cmd_fork_test() {
  banner

  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

  local fork_rpc="${FORK_RPC:-${RPC_URL:-}}"

  if [ -z "$fork_rpc" ] || [[ "$fork_rpc" == *"sepolia"* ]]; then
    echo -e "${RED}  ✗${NC} Need a mainnet RPC endpoint for fork testing"
    echo ""
    echo -e "  Usage: ${BOLD}FORK_RPC=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY ./deploy.sh fork:test${NC}"
    echo ""
    echo "  This forks Ethereum Mainnet locally and tests the real Uniswap swap flow."
    echo "  No gas costs - everything runs on a local fork."
    echo ""
    echo "  If your RPC_URL already points to mainnet, just run:"
    echo -e "  ${BOLD}FORK_RPC=\$RPC_URL ./deploy.sh fork:test${NC}"
    echo ""
    exit 1
  fi

  log "Compiling contracts..."
  npx hardhat compile --quiet
  echo ""

  log "Starting mainnet fork test..."
  log "Fork RPC: ${fork_rpc:0:45}..."
  echo ""

  FORK_RPC="$fork_rpc" npx hardhat test test/fork-swap.test.ts
}

# ── Simulate yield ────────────────────────────────────────────────────────────

cmd_simulate_yield() {
  banner

  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

  if [ -z "${TREASURY:-}" ]; then
    echo -e "${RED}  ✗${NC} TREASURY env var required"
    echo ""
    echo -e "  Usage: ${BOLD}TREASURY=0xYourTreasuryAddress ./deploy.sh simulate:yield${NC}"
    echo -e "         ${BOLD}TREASURY=0x... YIELD=0.5 ./deploy.sh simulate:yield${NC}"
    echo ""
    echo -e "  Find your treasury address on the dashboard under Treasury Overview"
    exit 1
  fi

  preflight
  log "Simulating yield for treasury ${TREASURY}..."
  npx hardhat run scripts/simulate-yield.ts --network sepolia
}

# ── Help ───────────────────────────────────────────────────────────────────────

cmd_help() {
  echo ""
  echo -e "  ${BOLD}🚀 YieldsPilot Deploy Script${NC}"
  echo ""
  echo -e "  ${BOLD}Usage:${NC}  ./deploy.sh <command> [args]"
  echo ""
  echo -e "  ${BOLD}Deploy commands:${NC}"
  echo ""
  echo "    fresh            ⭐ Full setup - MockUSDC + MockRouter + Registry"
  echo "                        Recommended starting point for any new environment."
  echo "                        Prints a ready-to-paste .env block when done."
  echo ""
  echo "    registry         Deploy Registry only (multi-user treasury factory)"
  echo "                        Use when mocks already exist or on real stETH network."
  echo ""
  echo "    treasury         Deploy single-user Treasury directly"
  echo "                        Simpler setup, no Registry needed."
  echo ""
  echo "    mocks            Deploy MockUSDC + MockRouter only"
  echo "                        Redeploy testnet swap infra without touching Registry."
  echo ""
  echo "    mocks-all        Deploy ALL mocks: MockStETH + MockWstETH + MockUSDC + MockRouter"
  echo "                        Fully self-contained testnet with mintable stETH/wstETH."
  echo "                        Use this when you want your own faucet tokens."
  echo ""
  echo -e "  ${BOLD}Mainnet:${NC}"
  echo ""
  echo "    mainnet          Deploy Registry to Ethereum Mainnet (production)"
  echo "                        Uses real Lido stETH/wstETH - no mocks deployed."
  echo "                        Point RPC_URL at a mainnet endpoint first."
  echo ""
  echo -e "  ${BOLD}Other networks:${NC}"
  echo ""
  echo "    status           Deploy to Status Network Sepolia (gasless, chainId=2020)"
  echo ""
  echo "    verify <addr>    Verify contract on Etherscan"
  echo "      [ContractName]   Optional: YieldsPilotRegistry (default), YieldsPilotTreasury"
  echo "      [network]        Optional: sepolia (default) or mainnet"
  echo "                       Requires ETHERSCAN_API_KEY in .env"
  echo ""
  echo -e "  ${BOLD}Testing (Sepolia):${NC}"
  echo ""
  echo "    mint             Mint mock stETH or wstETH to any wallet"
  echo "                       TOKEN=wsteth TO=0x... AMOUNT=10 ./deploy.sh mint"
  echo "                       Default: 10 stETH to deployer wallet"
  echo ""
  echo "    simulate:yield   Simulate yield accrual into a treasury"
  echo "                       TREASURY=0x... [YIELD=0.1] ./deploy.sh simulate:yield"
  echo ""
  echo "    fork:test        Test real Uniswap swap on a forked mainnet (zero gas cost)"
  echo "                       FORK_RPC=https://...mainnet... ./deploy.sh fork:test"
  echo "                       Deploys Treasury, injects yield, swaps stETH → USDC via Uniswap V3"
  echo ""
  echo -e "  ${BOLD}Other commands:${NC}"
  echo ""
  echo "    compile          Compile Solidity contracts"
  echo "    test             Run all 60 contract tests (Hardhat + Chai)"
  echo "    history          Show deployment history and latest manifest"
  echo "    help             Show this message"
  echo ""
  echo -e "  ${BOLD}Required .env variables:${NC}"
  echo ""
  echo "    AGENT_PRIVATE_KEY      Deployer/agent wallet private key"
  echo "    RPC_URL                Ethereum Sepolia RPC endpoint"
  echo ""
  echo -e "  ${BOLD}Optional .env variables:${NC}"
  echo ""
  echo "    STETH_ADDRESS          stETH address (default: Lido Sepolia testnet)"
  echo "    WSTETH_ADDRESS         wstETH address (default: Lido Sepolia testnet)"
  echo "    AGENT_WALLET           Agent address (default: derived from private key)"
  echo "    MAX_DAILY_BPS          Daily spend limit in bps (default: 5000 = 50%)"
  echo "    ETHERSCAN_API_KEY      Required for verify command"
  echo "    VITE_NETWORK           Frontend network: sepolia (default) or mainnet"
  echo ""
  echo -e "  ${DIM}Set by 'fresh' - paste into .env after running:${NC}"
  echo ""
  echo "    REGISTRY_CONTRACT      Deployed Registry address"
  echo "    MOCK_ROUTER_ADDRESS    Deployed MockRouter address"
  echo "    MOCK_TOKEN_OUT_ADDRESS Deployed MockUSDC address"
  echo ""
  echo -e "  ${BOLD}First-time setup:${NC}"
  echo ""
  echo "    1. Copy .env.example → .env"
  echo "    2. Fill in AGENT_PRIVATE_KEY and RPC_URL"
  echo "    3. Run: ./deploy.sh fresh"
  echo "    4. Paste the printed .env block into .env"
  echo "    5. Run: bun run agent"
  echo "    6. Open frontend, connect wallet, deposit stETH"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
  fresh)          cmd_fresh "$@" ;;
  registry)       cmd_registry "$@" ;;
  treasury)       cmd_treasury "$@" ;;
  mocks)          cmd_mocks "$@" ;;
  mocks-all|mocks:all) cmd_mocks_all "$@" ;;
  mainnet)        cmd_mainnet ;;
  status)         cmd_status ;;
  verify)         cmd_verify "${1:-}" "${2:-}" "${3:-sepolia}" ;;
  mint)           cmd_mint ;;
  fork:test|fork-test)  cmd_fork_test ;;
  simulate:yield|simulate-yield) cmd_simulate_yield ;;
  compile)        cmd_compile ;;
  test)           cmd_test ;;
  history)        cmd_history ;;
  help|--help|-h) cmd_help ;;
  *)
    echo -e "${RED}  Unknown command: $CMD${NC}"
    echo "  Run ./deploy.sh help for usage"
    exit 1
    ;;
esac
