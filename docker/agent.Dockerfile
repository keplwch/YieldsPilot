# ═══════════════════════════════════════════════════════
# YieldsPilot Agent — Multi-stage Docker Build
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
COPY agent/ ./agent/
COPY mcp/ ./mcp/
COPY agent.json ./

# Healthcheck — agent writes to agent_log.json on each cycle
HEALTHCHECK --interval=120s --timeout=10s --start-period=30s --retries=3 \
  CMD test $(find agent_log.json -mmin -5 | wc -l) -gt 0 || exit 1

CMD ["npx", "tsx", "agent/index.ts"]
