import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IS_MAINNET, NETWORK } from "@/config/network";

const activeChain = IS_MAINNET ? mainnet : sepolia;

const config = getDefaultConfig({
  appName: "YieldsPilot",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "b2c5e57fb6f2b0e6a35f3e8d6a0e5c4a",
  chains: [activeChain],
  // Use /rpc which Vite proxies to the RPC URL in .env (avoids CORS blocks
  // from public nodes that reject requests from localhost origins)
  transports: {
    [activeChain.id]: http("/rpc"),
  },
  ssr: false,
});

const queryClient = new QueryClient();

export default function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#a78bfa",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
          initialChain={activeChain}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export { config };
