# ═══════════════════════════════════════════════════════
# YieldsPilot Dashboard — Multi-stage Build
# Build with Vite, serve with Bun (no nginx)
# ═══════════════════════════════════════════════════════

# ── Build stage ───────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY frontend/package.json frontend/bun.lockb ./
RUN bun install --frozen-lockfile

COPY frontend/ .
RUN bun run build

# ── Serve stage ───────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY docker/serve.ts ./

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000 || exit 1

CMD ["bun", "serve.ts"]
