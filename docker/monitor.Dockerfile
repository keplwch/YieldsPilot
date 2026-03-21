# ═══════════════════════════════════════════════════════
# YieldsPilot Vault Monitor — Docker Build
# ═══════════════════════════════════════════════════════

FROM oven/bun:1-alpine AS base
WORKDIR /app

# ── Install deps ──────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install

# ── Production image ──────────────────────────────────
FROM base AS runner

COPY --from=deps /app/node_modules ./node_modules

COPY package.json tsconfig.json ./
COPY types/ ./types/
COPY config/ ./config/
COPY agent/services/ ./agent/services/

CMD ["bun", "agent/services/vaultMonitor.ts"]
