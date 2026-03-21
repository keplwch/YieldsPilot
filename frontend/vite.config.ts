import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Load root .env so we can proxy the RPC URL without exposing it in the bundle
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const rpcUrl = rootEnv.RPC_URL || "https://rpc.sepolia.org";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      open: true,
      proxy: {
        // Backend API
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
        // Ethereum RPC - proxied through localhost to avoid CORS blocks
        // from public nodes like Thirdweb that restrict browser origins
        "/rpc": {
          target: rpcUrl,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/rpc/, ""),
        },
      },
    },
  };
});
