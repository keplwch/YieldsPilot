#!/usr/bin/env bash
set -euo pipefail

# ╔══════════════════════════════════════════════════════════════╗
# ║  YieldPilot — Deploy Script                                 ║
# ║                                                              ║
# ║  Usage:                                                      ║
# ║    ./deploy.sh fresh           ⭐ Deploy everything fresh    ║
# ║    ./deploy.sh compile         Compile contracts only        ║
# ║    ./deploy.sh test            Run contract tests (55)       ║
# ║    ./deploy.sh sepolia         Deploy Treasury to Sepolia    ║
# ║    ./deploy.sh registry        Deploy Registry to Sepolia    ║
# ║    ./deploy.sh status          Deploy to Status Network      ║
# ║    ./deploy.sh verify <addr>   Verify on Etherscan           ║
# ║    ./deploy.sh all             Deploy to all networks        ║
# ║    ./deploy.sh history         Show deployment history       ║
# ╚══════════════════════════════════════════════════════════════╝

# ── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ── Paths ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
DEPLOY_LOG="$SCRIPT_DIR/.deploy_log"

# ── Helpers ─────────────────────────────────────────────────────
log()   { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; exit 1; }
header() {
  echo ""
  echo -e "${PURPLE}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${PURPLE}║${NC}  ${BOLD}$1${NC}"
  echo -e "${PURPLE}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

save_deployment() {
  local network="$1"
  local address="$2"
  local tx_hash="$3"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "$timestamp | $network | $address | $tx_hash" >> "$DEPLOY_LOG"
}

# ── Pre-flight checks ──────────────────────────────────────────
preflight() {
  log "Running pre-flight checks..."

  # Node.js
  if ! command -v node &>/dev/null; then
    fail "Node.js is not installed"
  fi
  local node_version
  node_version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 18 ]; then
    fail "Node.js >= 18 required (found v$node_version)"
  fi
  ok "Node.js $(node -v)"

  # node_modules
  if [ ! -d "node_modules" ]; then
    warn "node_modules missing — running npm install..."
    npm install --legacy-peer-deps
  fi
  ok "Dependencies installed"

  # .env file
  if [ ! -f "$ENV_FILE" ]; then
    warn ".env file not found — creating from .env.example"
    cp .env.example .env
    fail "Please fill in your .env file first, then re-run"
  fi
  ok ".env file exists"

  # Source .env
  set -a
  source "$ENV_FILE"
  set +a

  # Check critical keys
  if [ -z "${AGENT_PRIVATE_KEY:-}" ] || [ "${AGENT_PRIVATE_KEY}" = "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then
    fail "AGENT_PRIVATE_KEY not set in .env (needed for deployment)"
  fi
  ok "Private key configured"
}

# ── Commands ────────────────────────────────────────────────────

cmd_compile() {
  header "Compiling Contracts"
  npx hardhat compile
  ok "Compilation successful"
}

cmd_test() {
  header "Running Contract Tests"
  npx hardhat test
  ok "All tests passed"
}

cmd_sepolia() {
  preflight

  header "Deploying to Ethereum Sepolia"

  # Check RPC
  if [ -z "${RPC_URL:-}" ]; then
    warn "RPC_URL not set — using default Alchemy demo endpoint"
    warn "This may be rate-limited. Set RPC_URL in .env for reliable deploys"
  else
    ok "RPC URL: ${RPC_URL:0:40}..."
  fi

  # Show deployer info
  log "Deployer wallet (from AGENT_PRIVATE_KEY):"
  echo ""

  # Compile first
  log "Compiling contracts..."
  npx hardhat compile --quiet

  # Deploy
  log "Deploying YieldPilotTreasury..."
  echo ""
  npx hardhat run scripts/deploy-sepolia.ts --network sepolia

  echo ""
  ok "Sepolia deployment complete!"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo "  1. Copy the contract address into your .env as TREASURY_CONTRACT"
  echo "  2. Send some Sepolia stETH to the Treasury"
  echo "  3. Run the agent: ./dev.sh agent"
  echo ""
}

cmd_status() {
  preflight

  header "Deploying to Status Network Sepolia"

  log "This is for the 'Go Gasless' bounty (\$2,000)"
  log "Status Network Sepolia has gasPrice = 0"
  echo ""

  # Check if we need Status testnet ETH
  warn "Make sure you have Status Sepolia funds"
  warn "Faucet: https://faucet.status.im"
  echo ""

  # Compile
  log "Compiling contracts..."
  npx hardhat compile --quiet

  # Deploy
  log "Deploying..."
  echo ""
  npx hardhat run scripts/deploy-status.ts --network statusSepolia

  echo ""
  ok "Status Network deployment complete!"
  echo ""
  echo -e "${CYAN}Save the tx hashes above for your hackathon submission!${NC}"
  echo ""
}

cmd_verify() {
  local address="${1:-}"
  if [ -z "$address" ]; then
    fail "Usage: ./deploy.sh verify <contract-address>"
  fi

  preflight

  header "Verifying Contract on Etherscan"

  if [ -z "${ETHERSCAN_API_KEY:-}" ]; then
    fail "ETHERSCAN_API_KEY not set in .env"
  fi

  # Read constructor args from .env or use defaults
  local steth="${STETH_ADDRESS:-0x6df25A1734E181AFbBD9c8A50b1D00e39D482704}"
  local agent="${AGENT_WALLET:-}"
  local bps="5000"

  if [ -z "$agent" ]; then
    warn "AGENT_WALLET not set in .env, using AGENT_PRIVATE_KEY derived address"
    agent=$(node -e "
      const { ethers } = require('ethers');
      const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
      console.log(wallet.address);
    ")
  fi

  log "Verifying $address on Sepolia Etherscan..."
  log "Constructor args: stETH=$steth, agent=$agent, bps=$bps"
  echo ""

  npx hardhat verify --network sepolia "$address" "$steth" "$agent" "$bps"

  ok "Verification complete!"
  echo -e "  View: ${CYAN}https://sepolia.etherscan.io/address/${address}#code${NC}"
}

cmd_registry() {
  preflight

  header "Deploying Registry to Ethereum Sepolia"

  log "The Registry is a factory that creates per-user Treasury contracts."
  log "Each user gets their own isolated Treasury with yield separation."
  echo ""

  # Check RPC
  if [ -z "${RPC_URL:-}" ]; then
    warn "RPC_URL not set — using default Alchemy demo endpoint"
  else
    ok "RPC URL: ${RPC_URL:0:40}..."
  fi

  # Compile first
  log "Compiling contracts..."
  npx hardhat compile --quiet

  # Deploy
  log "Deploying YieldPilotRegistry..."
  echo ""
  npx hardhat run scripts/deploy-registry.ts --network sepolia

  echo ""
  ok "Registry deployment complete!"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo "  1. Copy the Registry address into your .env as REGISTRY_CONTRACT"
  echo "  2. Users approve stETH to the Registry, then call createTreasuryAndDeposit()"
  echo "  3. The agent auto-discovers and processes all registered treasuries"
  echo ""
}

cmd_fresh() {
  preflight

  header "Fresh Full Deploy (MockUSDC + MockRouter + Registry)"

  log "Deploys everything for a testnet demo with atomic swaps:"
  log "  1. MockUSDC        — output token for swaps"
  log "  2. MockRouter      — simulates Uniswap on testnet"
  log "  3. Registry        — multi-user treasury factory"
  log "  4. Configures MockRouter + Uniswap Router as default targets"
  echo ""
  log "After deployment, create a user treasury from the UI."
  echo ""

  # Check RPC
  if [ -z "${RPC_URL:-}" ]; then
    warn "RPC_URL not set — using default Alchemy demo endpoint"
  else
    ok "RPC URL: ${RPC_URL:0:40}..."
  fi

  # Compile first
  log "Compiling contracts..."
  npx hardhat compile --quiet

  # Deploy everything in one script
  echo ""
  npx hardhat run scripts/deploy-fresh.ts --network sepolia

  echo ""
  ok "Fresh deployment complete!"
  echo ""
  echo -e "${CYAN}Next steps:${NC}"
  echo "  1. Copy the printed .env values into your .env file"
  echo "  2. Restart agent:  bun run agent"
  echo "  3. Open frontend, connect wallet, deposit stETH"
  echo "  4. Agent will use swapYield() with MockRouter — real atomic swaps on testnet!"
  echo ""
}

cmd_all() {
  header "Deploying to ALL Networks"

  echo -e "${YELLOW}This will deploy to:${NC}"
  echo "  1. Ethereum Sepolia  — Registry (multi-user factory)"
  echo "  2. Ethereum Sepolia  — Treasury (single-user, backward compat)"
  echo "  3. Status Sepolia    (bonus — Go Gasless bounty)"
  echo ""
  read -p "Continue? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "Aborted."
    exit 0
  fi

  cmd_registry
  echo ""
  echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  cmd_sepolia
  echo ""
  echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  cmd_status

  echo ""
  header "All Deployments Complete!"
  echo -e "${GREEN}  Both networks deployed successfully.${NC}"
  echo ""
  echo "  Don't forget to:"
  echo "    1. Update .env with TREASURY_CONTRACT address"
  echo "    2. Register ERC-8004 identity at synthesis.devfolio.co"
  echo "    3. Record your demo video with: ./dev.sh start"
  echo ""
}

cmd_history() {
  header "Deployment History"

  if [ ! -f "$DEPLOY_LOG" ]; then
    warn "No deployments recorded yet"
    return
  fi

  echo -e "${BOLD}Timestamp                  | Network         | Address                                    | TX Hash${NC}"
  echo "─────────────────────────────────────────────────────────────────────────────────────────────────────────"
  cat "$DEPLOY_LOG"
  echo ""
}

cmd_help() {
  echo ""
  echo -e "${BOLD}YieldPilot Deploy Script${NC}"
  echo ""
  echo "Usage: ./deploy.sh <command> [args]"
  echo ""
  echo -e "${BOLD}Commands:${NC}"
  echo "  fresh            ⭐ Deploy everything fresh (MockUSDC + MockRouter + Registry)"
  echo "  compile          Compile Solidity contracts"
  echo "  test             Run contract tests (55 tests)"
  echo "  sepolia          Deploy single Treasury to Ethereum Sepolia"
  echo "  registry         Deploy multi-user Registry to Ethereum Sepolia"
  echo "  status           Deploy to Status Network Sepolia (gasless bounty)"
  echo "  verify <addr>    Verify contract on Etherscan"
  echo "  all              Deploy to all networks (Registry + Treasury + Status)"
  echo "  history          Show deployment history"
  echo "  help             Show this help"
  echo ""
  echo -e "${BOLD}Required .env variables:${NC}"
  echo "  AGENT_PRIVATE_KEY    Deployer/agent wallet private key"
  echo "  RPC_URL              Ethereum Sepolia RPC endpoint"
  echo ""
  echo -e "${BOLD}Optional .env variables:${NC}"
  echo "  STETH_ADDRESS            Sepolia stETH address (default: Lido testnet)"
  echo "  AGENT_WALLET             Agent address (default: derived from private key)"
  echo "  ETHERSCAN_API_KEY        For contract verification"
  echo "  MOCK_ROUTER_ADDRESS      MockRouter for testnet atomic swaps (set by 'fresh')"
  echo "  MOCK_TOKEN_OUT_ADDRESS   MockUSDC output token (set by 'fresh')"
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  ./deploy.sh fresh                    # ⭐ Start here — deploys everything"
  echo "  ./deploy.sh compile                  # Just compile"
  echo "  ./deploy.sh test                     # Run all 55 tests"
  echo "  ./deploy.sh sepolia                  # Deploy single Treasury to Sepolia"
  echo "  ./deploy.sh registry                 # Deploy multi-user Registry"
  echo "  ./deploy.sh verify 0xABC...123       # Verify on Etherscan"
  echo "  ./deploy.sh all                      # Deploy to all networks"
  echo "  ./deploy.sh history                  # Show past deployments"
  echo ""
}

# ── Main ────────────────────────────────────────────────────────
case "${1:-help}" in
  fresh)      cmd_fresh ;;
  compile)    cmd_compile ;;
  test)       cmd_test ;;
  sepolia)    cmd_sepolia ;;
  registry)   cmd_registry ;;
  status)     cmd_status ;;
  verify)     cmd_verify "${2:-}" ;;
  all)        cmd_all ;;
  history)    cmd_history ;;
  help|--help|-h) cmd_help ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    cmd_help
    exit 1
    ;;
esac
