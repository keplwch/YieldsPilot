// ═══════════════════════════════════════════════════════
// YieldsPilot Dashboard — Bun static file server
// Serves dist/ and proxies /api/* to the API container
// ═══════════════════════════════════════════════════════

const STATIC_DIR = "./dist";
const API_ORIGIN = process.env.API_URL ?? "http://api:3001";
const PORT = 3000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const ext = (path: string) => path.match(/\.[^./]+$/)?.[0] ?? "";

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── API proxy ────────────────────────────────────
    if (path.startsWith("/api")) {
      const target = `${API_ORIGIN}${path}${url.search}`;
      return fetch(target, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      });
    }

    // ── Static files ─────────────────────────────────
    const filePath = `${STATIC_DIR}${path === "/" ? "/index.html" : path}`;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const e = ext(filePath);
      const isAsset = path.startsWith("/assets/");
      return new Response(file, {
        headers: {
          "Content-Type": MIME[e] ?? "application/octet-stream",
          ...(isAsset
            ? { "Cache-Control": "public, max-age=31536000, immutable" }
            : {}),
        },
      });
    }

    // ── SPA fallback ─────────────────────────────────
    return new Response(Bun.file(`${STATIC_DIR}/index.html`), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Dashboard → http://0.0.0.0:${PORT}  (API → ${API_ORIGIN})`);
