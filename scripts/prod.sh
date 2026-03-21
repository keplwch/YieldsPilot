#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║           🛫 YieldsPilot — Production (Docker)               ║
# ║  Builds & runs agent + monitor + dashboard via Compose      ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Colors ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

log()  { echo -e "${CYAN}[yield-pilot]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
err()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }

# ── Banner ─────────────────────────────────────────────────────
echo -e "${PURPLE}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       🛫 YieldsPilot Production Mode      ║"
echo "  ║        Docker Compose Deployment         ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Pre-flight checks ─────────────────────────────────────────
log "Pre-flight checks..."

if ! command -v docker &>/dev/null; then
  err "Docker not found! Install from https://docker.com"
fi
ok "Docker $(docker --version | awk '{print $3}')"

if ! docker compose version &>/dev/null 2>&1; then
  if ! docker-compose version &>/dev/null 2>&1; then
    err "Docker Compose not found!"
  fi
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi
ok "Docker Compose available"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn ".env created from .env.example — fill in your API keys!"
    warn "Run: nano .env"
    exit 1
  else
    err ".env.example missing!"
  fi
else
  ok ".env found"
fi

# ── Parse command ──────────────────────────────────────────────
CMD="${1:-up}"

case "$CMD" in
  up|start)
    log "Building and starting all services..."
    $COMPOSE up --build -d

    echo ""
    echo -e "${GREEN}${BOLD}  ✅ YieldsPilot is running in production!${NC}"
    echo ""
    echo -e "  ${CYAN}Dashboard${NC}   → http://localhost:3000"
    echo -e "  ${CYAN}Agent${NC}       → docker compose logs -f agent"
    echo -e "  ${CYAN}Monitor${NC}     → docker compose logs -f monitor"
    echo ""
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "    ./prod.sh logs      — tail all logs"
    echo -e "    ./prod.sh stop      — stop all services"
    echo -e "    ./prod.sh restart   — rebuild & restart"
    echo -e "    ./prod.sh status    — show running containers"
    echo ""
    ;;

  down|stop)
    log "Stopping all services..."
    $COMPOSE down
    ok "All services stopped"
    ;;

  restart)
    log "Restarting all services..."
    $COMPOSE down
    $COMPOSE up --build -d
    ok "All services restarted"
    ;;

  logs)
    log "Tailing logs (Ctrl+C to exit)..."
    $COMPOSE logs -f --tail=50
    ;;

  status|ps)
    $COMPOSE ps
    ;;

  build)
    log "Building images..."
    $COMPOSE build
    ok "All images built"
    ;;

  *)
    echo "Usage: ./prod.sh [up|stop|restart|logs|status|build]"
    echo ""
    echo "  up / start    Build & start all containers (default)"
    echo "  stop / down   Stop all containers"
    echo "  restart       Rebuild & restart"
    echo "  logs          Tail all container logs"
    echo "  status        Show container status"
    echo "  build         Build images without starting"
    exit 1
    ;;
esac
