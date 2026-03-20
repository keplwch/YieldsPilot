# ═══════════════════════════════════════════════════════
# YieldPilot Dashboard — Multi-stage Build
# Build with Vite, serve with nginx
# ═══════════════════════════════════════════════════════

# ── Build stage ───────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ .
RUN npm run build

# ── Serve stage ───────────────────────────────────────
FROM nginx:alpine AS runner

# Custom nginx config for SPA routing
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1
