# ═══════════════════════════════════════════════════════
# YieldsPilot Agent — Multi-stage Docker Build
# ═══════════════════════════════════════════════════════

FROM node:20-alpine AS base
WORKDIR /app

# ── Install deps ──────────────────────────────────────
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps --ignore-scripts

# ── Production image ──────────────────────────────────
FROM base AS runner

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY package.json tsconfig.json ./
COPY types/ ./types/
COPY config/ ./config/
COPY agent/ ./agent/
COPY mcp/ ./mcp/
COPY agent.json agent_log.json ./
COPY lido.skill.md ./

# Healthcheck — agent writes to agent_log.json on each cycle
HEALTHCHECK --interval=120s --timeout=10s --start-period=30s --retries=3 \
  CMD test $(find agent_log.json -mmin -5 | wc -l) -gt 0 || exit 1

# Default: run the agent
CMD ["npx", "tsx", "agent/index.ts"]
