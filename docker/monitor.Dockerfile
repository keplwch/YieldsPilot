# ═══════════════════════════════════════════════════════
# YieldsPilot Vault Monitor — Docker Build
# ═══════════════════════════════════════════════════════

FROM node:20-alpine AS base
WORKDIR /app

# ── Install deps ──────────────────────────────────────
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps --ignore-scripts

# ── Production image ──────────────────────────────────
FROM base AS runner

COPY --from=deps /app/node_modules ./node_modules

COPY package.json tsconfig.json ./
COPY types/ ./types/
COPY config/ ./config/
COPY agent/services/ ./agent/services/

CMD ["npx", "tsx", "agent/services/vaultMonitor.ts"]
