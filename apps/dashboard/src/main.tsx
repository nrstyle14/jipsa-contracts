import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import { wagmiConfig } from "./config/wagmi.js";
import { ViewerProvider } from "./viewer.js";
import "./index.css";

/**
 * 폴링 실패는 조용히 재시도한다 (설계서 §7 데모 안정성).
 * 공개 RPC의 일시적 429로 화면이 깨지지 않게 한다.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 3, retryDelay: (n) => Math.min(1000 * 2 ** n, 8000) } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ViewerProvider>
          <App />
        </ViewerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
