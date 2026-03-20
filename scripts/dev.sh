#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║              🛫 YieldPilot — Local Dev Runner                   ║
# ║                                                                 ║
# ║  Services                                                       ║
# ║    ./dev.sh                  Start everything (default)         ║
# ║    ./dev.sh start            Same as above                      ║
# ║    ./dev.sh frontend         Frontend (Vite) only               ║
# ║    ./dev.sh api              API server only                    ║
# ║    ./dev.sh agent            Agent only                         ║
# ║    ./dev.sh monitor          Vault monitor only                 ║
# ║    ./dev.sh stop             Kill all running YieldPilot procs  ║
# ║    ./dev.sh restart          Stop + start all                   ║
# ║    ./dev.sh status           Show which services are running    ║
# ║                                                                 ║
# ║  Logs                                                           ║
# ║    ./dev.sh logs             Tail all logs                      ║
# ║    ./dev.sh logs frontend    Tail frontend log                  ║
# ║    ./dev.sh logs api         Tail API log                       ║
# ║    ./dev.sh logs agent       Tail agent log                     ║
# ║    ./dev.sh logs monitor     Tail monitor log                   ║
# ║                                                                 ║
# ║  Testing (Sepolia)                                              ║
# ║    ./dev.sh deploy:mock      Deploy MockStETH + Registry        ║
# ║    ./dev.sh simulate:yield   Mint yield into a treasury         ║
# ║      TREASURY=0x... [YIELD=0.1] ./dev.sh simulate:yield        ║
# ║                                                                 ║
# ║  Tooling                                                        ║
# ║    ./dev.sh install          Install all deps                   ║
# ║    ./dev.sh typecheck        Run TypeScript checks              ║
# ║    ./dev.sh clean            Nuke node_modules & reinstall      ║
# ║    ./dev.sh help             Show this message                  ║
# ╚══════════════════════════════════════════════════════════════════╝

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"

# ── Colors ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
DIM='\033[2m'
NC='\033[0m'
BOLD='\033[1m'

log()  { echo -e "${CYAN}[yield-pilot]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
err()  { echo -e "${RED}  ✗${NC} $1"; }

banner() {
  echo -e "${PURPLE}${BOLD}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║         🛫 YieldPilot Dev Mode           ║"
  echo "  ║   Private Cognition → Trusted Action     ║"
  echo "  ╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

# ══════════════════════════════════════════════════════════════
#  ENV CHECK
# ══════════════════════════════════════════════════════════════

check_env() {
  log "Checking environment..."

  # Auto-create .env
  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      warn ".env created from .env.example — edit it: ${BOLD}nano .env${NC}"
    else
      err ".env.example missing!"; exit 1
    fi
  else
    ok ".env found"
  fi

  # Source it
  set -a; source .env 2>/dev/null || true; set +a

  # Report missing keys
  local missing=0
  check_key() {
    local val="${!1:-}"
    if [ -z "$val" ] || [ "$val" = "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" ]; then
      echo -e "     ${DIM}○${NC} ${YELLOW}$1${NC}"
      missing=1
    else
      echo -e "     ${GREEN}●${NC} $1"
    fi
  }

  echo ""
  echo -e "  ${BOLD}API Keys:${NC}"
  check_key "VENICE_API_KEY"
  check_key "BANKR_API_KEY"
  check_key "UNISWAP_API_KEY"
  check_key "RPC_URL"
  check_key "AGENT_PRIVATE_KEY"
  check_key "TELEGRAM_BOT_TOKEN"
  echo ""

  if [ "$missing" -eq 1 ]; then
    warn "Some keys missing — frontend works fine, agent/monitor need them"
  else
    ok "All keys configured"
  fi
}

# ══════════════════════════════════════════════════════════════
#  NODE CHECK
# ══════════════════════════════════════════════════════════════

check_node() {
  if ! command -v node &>/dev/null; then
    err "Node.js not found! Install from https://nodejs.org"; exit 1
  fi

  local ver
  ver=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$ver" -lt 18 ]; then
    err "Node.js >= 18 required (found $(node -v))"; exit 1
  fi
  ok "Node $(node -v)"
}

# ══════════════════════════════════════════════════════════════
#  INSTALL
# ══════════════════════════════════════════════════════════════

install_deps() {
  log "Installing dependencies..."

  # Backend
  if [ ! -d "node_modules/.package-lock.json" ] 2>/dev/null; then
    log "  → backend deps..."
    npm install --legacy-peer-deps 2>&1 | grep -E "^(added|npm warn)" | head -5
    ok "Backend deps"
  else
    ok "Backend deps (cached)"
  fi

  # Frontend
  if [ ! -d "frontend/node_modules" ]; then
    log "  → frontend deps..."
    (cd frontend && npm install 2>&1 | grep -E "^(added|npm warn)" | head -5)
    ok "Frontend deps"
  else
    ok "Frontend deps (cached)"
  fi
}

# ══════════════════════════════════════════════════════════════
#  TYPECHECK
# ══════════════════════════════════════════════════════════════

typecheck() {
  log "Running TypeScript checks..."

  local has_errors=0

  # Backend — use frontend's tsc since it's reliably installed
  local tsc="./frontend/node_modules/.bin/tsc"
  if [ -x "$tsc" ]; then
    local be_out
    be_out=$($tsc -p tsconfig.json --noEmit 2>&1) || true
    if [ -n "$be_out" ]; then
      warn "Backend:"
      echo "$be_out" | head -20
      has_errors=1
    else
      ok "Backend — 0 errors"
    fi
  else
    warn "tsc not found — run ./dev.sh install first"
  fi

  # Frontend
  local fe_out
  fe_out=$(cd frontend && npx tsc --noEmit 2>&1) || true
  if [ -n "$fe_out" ]; then
    warn "Frontend:"
    echo "$fe_out" | head -20
    has_errors=1
  else
    ok "Frontend — 0 errors"
  fi

  return $has_errors
}

# ══════════════════════════════════════════════════════════════
#  PROCESS MANAGEMENT
# ══════════════════════════════════════════════════════════════

mkdir -p "$PID_DIR" "$LOG_DIR"

save_pid() {
  echo "$2" > "$PID_DIR/$1.pid"
}

is_running() {
  local pidfile="$PID_DIR/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pidfile"
  fi
  return 1
}

stop_service() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      # Wait up to 5s for graceful shutdown
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      # Force kill if still alive
      kill -9 "$pid" 2>/dev/null || true
      ok "Stopped $name (PID $pid)"
    fi
    rm -f "$pidfile"
  fi
}

free_frontend_ports() {
  for port in 5173 5174 5175 5176 5177; do
    local pid
    pid=$(lsof -ti tcp:$port 2>/dev/null) || true
    if [ -n "$pid" ]; then
      kill -9 $pid 2>/dev/null || true
      ok "Freed port $port (PID $pid)"
    fi
  done
}

free_api_port() {
  local pid
  pid=$(lsof -ti tcp:3001 2>/dev/null) || true
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null || true
    ok "Freed port 3001 (PID $pid)"
  fi
}

stop_all() {
  log "Stopping all services..."
  stop_service "frontend"
  stop_service "api"
  stop_service "agent"
  stop_service "monitor"
  free_frontend_ports
  free_api_port
  ok "All stopped"
}

# ══════════════════════════════════════════════════════════════
#  SERVICE LAUNCHERS
# ══════════════════════════════════════════════════════════════

start_frontend() {
  if is_running "frontend"; then
    warn "Frontend already running (PID $(cat $PID_DIR/frontend.pid))"
    return
  fi

  free_frontend_ports
  log "Starting frontend → ${BOLD}http://localhost:5173${NC}"
  (cd frontend && npx vite --host 2>&1) > "$LOG_DIR/frontend.log" 2>&1 &
  save_pid "frontend" $!
  ok "Frontend started (PID $!) → logs: .logs/frontend.log"
}

start_agent() {
  # Source env for checks
  set -a; source .env 2>/dev/null || true; set +a

  if [ -z "${VENICE_API_KEY:-}" ]; then
    warn "Skipping agent — VENICE_API_KEY not set in .env"
    return
  fi

  if is_running "agent"; then
    warn "Agent already running (PID $(cat $PID_DIR/agent.pid))"
    return
  fi

  log "Starting agent..."
  npx tsx agent/index.ts > "$LOG_DIR/agent.log" 2>&1 &
  save_pid "agent" $!
  ok "Agent started (PID $!) → logs: .logs/agent.log"
}

start_api() {
  if is_running "api"; then
    warn "API already running (PID $(cat $PID_DIR/api.pid))"
    return
  fi

  log "Starting API server → ${BOLD}http://localhost:3001${NC}"
  npx tsx api/server.ts > "$LOG_DIR/api.log" 2>&1 &
  save_pid "api" $!
  ok "API started (PID $!) → logs: .logs/api.log"
}

start_monitor() {
  set -a; source .env 2>/dev/null || true; set +a

  local rpc="${RPC_URL:-}"
  if [ -z "$rpc" ] || [ "$rpc" = "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" ]; then
    warn "Skipping monitor — RPC_URL not set in .env"
    return
  fi

  if is_running "monitor"; then
    warn "Monitor already running (PID $(cat $PID_DIR/monitor.pid))"
    return
  fi

  log "Starting vault monitor..."
  npx tsx agent/services/vaultMonitor.ts > "$LOG_DIR/monitor.log" 2>&1 &
  save_pid "monitor" $!
  ok "Monitor started (PID $!) → logs: .logs/monitor.log"
}

# ══════════════════════════════════════════════════════════════
#  STATUS
# ══════════════════════════════════════════════════════════════

show_status() {
  echo ""
  echo -e "  ${BOLD}Service Status:${NC}"
  echo ""

  for svc in frontend api agent monitor; do
    if is_running "$svc"; then
      local pid
      pid=$(cat "$PID_DIR/$svc.pid")
      echo -e "    ${GREEN}●${NC} ${BOLD}$svc${NC}  PID $pid  ${DIM}(logs: .logs/$svc.log)${NC}"
    else
      echo -e "    ${DIM}○${NC} ${DIM}$svc  not running${NC}"
    fi
  done
  echo ""
}

# ══════════════════════════════════════════════════════════════
#  TAIL LOGS
# ══════════════════════════════════════════════════════════════

tail_logs() {
  local target="${1:-all}"

  if [ "$target" = "all" ]; then
    tail -f "$LOG_DIR"/*.log 2>/dev/null || warn "No log files yet"
  else
    local logfile="$LOG_DIR/$target.log"
    if [ -f "$logfile" ]; then
      tail -f "$logfile"
    else
      warn "No log file for $target"
    fi
  fi
}

# ══════════════════════════════════════════════════════════════
#  CLEAN
# ══════════════════════════════════════════════════════════════

clean_install() {
  log "Cleaning everything..."
  stop_all
  rm -rf node_modules package-lock.json frontend/node_modules frontend/package-lock.json .pids .logs
  ok "Cleaned"

  install_deps
}

# ══════════════════════════════════════════════════════════════
#  START ALL (default)
# ══════════════════════════════════════════════════════════════

start_all() {
  banner
  check_node
  check_env
  install_deps
  typecheck || true  # non-blocking

  echo ""
  echo -e "  ${PURPLE}${BOLD}Starting services...${NC}"
  echo ""

  start_api
  start_frontend
  start_agent
  start_monitor

  echo ""
  echo -e "${GREEN}${BOLD}  ✅ YieldPilot is running!${NC}"

  show_status

  echo -e "  ${BOLD}Commands:${NC}"
  echo -e "    ./dev.sh logs             Tail all logs"
  echo -e "    ./dev.sh logs frontend    Tail frontend only"
  echo -e "    ./dev.sh status           Check what's running"
  echo -e "    ./dev.sh stop             Stop everything"
  echo -e "    ./dev.sh restart          Stop + start"
  echo ""
  echo -e "  ${CYAN}Dashboard${NC} → ${BOLD}http://localhost:5173${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════
#  MAIN — parse command
# ══════════════════════════════════════════════════════════════

CMD="${1:-start}"
shift 2>/dev/null || true

case "$CMD" in
  start|up|"")
    start_all
    ;;
  frontend|fe|ui)
    banner
    check_node
    install_deps
    start_frontend
    echo -e "\n  ${CYAN}Dashboard${NC} → ${BOLD}http://localhost:5173${NC}\n"
    echo -e "  Tail logs: ${DIM}./dev.sh logs frontend${NC}\n"
    ;;
  api)
    banner
    check_node
    check_env
    install_deps
    start_api
    echo -e "\n  API → ${BOLD}http://localhost:3001${NC}"
    echo -e "  Tail logs: ${DIM}./dev.sh logs api${NC}\n"
    ;;
  agent)
    banner
    check_node
    check_env
    install_deps
    start_agent
    echo -e "\n  Tail logs: ${DIM}./dev.sh logs agent${NC}\n"
    ;;
  monitor|mon)
    banner
    check_node
    check_env
    install_deps
    start_monitor
    echo -e "\n  Tail logs: ${DIM}./dev.sh logs monitor${NC}\n"
    ;;
  stop|down)
    stop_all
    ;;
  restart)
    stop_all
    sleep 1
    start_all
    ;;
  status|ps)
    banner
    show_status
    ;;
  logs|log)
    tail_logs "${1:-all}"
    ;;
  install|i)
    banner
    check_node
    install_deps
    ;;
  typecheck|tc|tsc)
    banner
    typecheck
    ;;
  clean)
    clean_install
    ;;
  deploy:mock|deploy-mock)
    banner
    check_node
    check_env
    log "Deploying MockStETH + Registry to Sepolia..."
    npx hardhat run scripts/deploy-mock.ts --network sepolia
    ;;
  simulate:yield|simulate-yield)
    banner
    check_env
    if [ -z "${TREASURY:-}" ]; then
      err "TREASURY env var required"
      echo ""
      echo -e "  Usage: ${BOLD}TREASURY=0xYourTreasuryAddress ./dev.sh simulate:yield${NC}"
      echo -e "         ${BOLD}TREASURY=0x... YIELD=0.5 ./dev.sh simulate:yield${NC}"
      echo ""
      echo -e "  Find your treasury address on the dashboard under Treasury Overview"
      exit 1
    fi
    log "Simulating yield for treasury ${TREASURY}..."
    npx hardhat run scripts/simulate-yield.ts --network sepolia
    ;;
  help|-h|--help)
    echo ""
    echo -e "  ${BOLD}🛫 YieldPilot Dev Runner${NC}"
    echo ""
    echo -e "  ${BOLD}Usage:${NC} ./dev.sh [command]"
    echo ""
    echo -e "  ${BOLD}Commands:${NC}"
    echo "    start                   Start all services (default)"
    echo "    frontend                Start frontend only"
    echo "    agent                   Start agent only"
    echo "    monitor                 Start vault monitor only"
    echo "    stop                    Stop all running services"
    echo "    restart                 Stop + start all"
    echo "    status                  Show which services are running"
    echo "    logs [svc]              Tail logs (all, frontend, agent, monitor)"
    echo "    install                 Install all dependencies"
    echo "    typecheck               Run TypeScript type checks"
    echo "    clean                   Nuke node_modules & reinstall"
    echo ""
    echo -e "  ${BOLD}Testing:${NC}"
    echo "    deploy:mock             Deploy MockStETH + Registry to Sepolia"
    echo "    simulate:yield          Simulate yield accrual into a treasury"
    echo "                            Usage: TREASURY=0x... [YIELD=0.1] ./dev.sh simulate:yield"
    echo ""
    echo "    help                    Show this message"
    echo ""
    ;;
  *)
    err "Unknown command: $CMD"
    echo "  Run ./dev.sh help for usage"
    exit 1
    ;;
esac
