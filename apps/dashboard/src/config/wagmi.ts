import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { giwaSepolia } from "./chain.js";

/**
 * MetaMask 인젝티드 커넥터만 쓴다.
 * WalletConnect는 범위에서 제외 (설계서 v1.1) — 필요해지면 connectors에 1줄 추가.
 */
export const wagmiConfig = createConfig({
  chains: [giwaSepolia],
  connectors: [injected()],
  transports: { [giwaSepolia.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
