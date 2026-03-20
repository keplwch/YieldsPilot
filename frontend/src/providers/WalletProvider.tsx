import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

const config = getDefaultConfig({
  appName: "YieldPilot",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "b2c5e57fb6f2b0e6a35f3e8d6a0e5c4a",
  chains: [sepolia],
  // Use /rpc which Vite proxies to the Alchemy URL in .env (avoids CORS blocks
  // from Thirdweb's public node which rejects requests from localhost origins)
  transports: {
    [sepolia.id]: http("/rpc"),
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
          initialChain={sepolia}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export { config };
