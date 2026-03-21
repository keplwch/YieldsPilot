// ═══════════════════════════════════════════════════════
// YieldsPilot Dashboard - Node static file server
// Serves dist/ and proxies /api/* to the API container
// ═══════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const STATIC_DIR = path.resolve("./dist");
const API_ORIGIN = process.env.API_URL ?? "http://api:3001";
const RPC_URL = process.env.RPC_URL ?? "";
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

const ext = (p: string) => path.extname(p) || "";

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── RPC proxy ───────────────────────────────────
  // Wagmi sends JSON-RPC calls to /rpc to avoid CORS issues with
  // public RPC nodes. Forward them to the actual RPC_URL.
  if (pathname === "/rpc" && RPC_URL) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const rpcTarget = new URL(RPC_URL);
    const transport = rpcTarget.protocol === "https:" ? https : http;

    const proxyReq = transport.request(
      {
        hostname: rpcTarget.hostname,
        port: rpcTarget.port || (rpcTarget.protocol === "https:" ? 443 : 80),
        path: rpcTarget.pathname + rpcTarget.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: rpcTarget.host,
        },
        timeout: 30_000,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "RPC unreachable" }));
    });
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "RPC timeout" }));
    });
    req.pipe(proxyReq);
    return;
  }

  // ── API proxy ────────────────────────────────────
  if (pathname.startsWith("/api")) {
    const target = `${API_ORIGIN}${pathname}${url.search}`;
    const proxyReq = http.request(target, { method: req.method, timeout: 30_000 }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, {
        "Content-Type": proxyRes.headers["content-type"] ?? "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    });
    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "API unreachable" }));
    });
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "API timeout" }));
    });
    if (req.method === "GET" || req.method === "HEAD") {
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
    return;
  }

  // ── Static files ─────────────────────────────────
  const filePath = path.join(STATIC_DIR, pathname === "/" ? "index.html" : pathname);
  const safePath = path.resolve(filePath);

  // Prevent directory traversal
  if (!safePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const e = ext(safePath);
      const isAsset = pathname.startsWith("/assets/");
      const headers: Record<string, string> = {
        "Content-Type": MIME[e] ?? "application/octet-stream",
      };
      if (isAsset) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }
      res.writeHead(200, headers);
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // ── SPA fallback ─────────────────────────────────
    const indexPath = path.join(STATIC_DIR, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(indexPath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard → http://0.0.0.0:${PORT}  (API → ${API_ORIGIN})`);
});
