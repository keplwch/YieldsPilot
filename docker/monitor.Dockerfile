# ═══════════════════════════════════════════════════════
# YieldsPilot Vault Monitor - Docker Build
# ═══════════════════════════════════════════════════════

FROM node:22-alpine AS base
WORKDIR /app

# ── Install deps (use bun for speed) ────────────────
FROM base AS deps
RUN npm i -g bun
COPY package.json bun.lock ./
RUN bun install

# ── Production image ──────────────────────────────────
FROM base AS runner

COPY --from=deps /app/node_modules ./node_modules

COPY package.json tsconfig.json ./
COPY types/ ./types/
COPY config/ ./config/
COPY agent/services/ ./agent/services/

CMD ["npx", "tsx", "agent/services/vaultMonitor.ts"]
