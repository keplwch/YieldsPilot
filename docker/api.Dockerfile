# ═══════════════════════════════════════════════════════
# YieldsPilot API - Express REST Server
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
COPY api/ ./api/

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/status || exit 1

CMD ["npx", "tsx", "api/server.ts"]
