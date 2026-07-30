import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { giwaSepolia } from "./chain.js";

/**
 * 지갑 연결 — **EIP-6963 탐색**에 맡긴다 (wagmi 기본값 `multiInjectedProviderDiscovery`).
 *
 * MetaMask 와 Rabby 를 함께 깔면 둘이 `window.ethereum` 을 서로 차지하려 다투므로,
 * 커넥터를 하나로 고정하면 어느 지갑이 열릴지 예측할 수 없다. 6963 으로 발견된 지갑을
 * 나열해 사용자가 고르게 한다 (`WalletPicker`).
 *
 * 이게 데모에서 중요한 이유: MetaMask 는 dapp 의 위임 서명 요청을 정책적으로 차단한다.
 * 어느 지갑으로 서명하느냐가 Act 1 의 성패를 가른다.
 *
 * `injected()` 는 6963 을 announce 하지 않는 지갑용 폴백으로 남긴다. WalletPicker 가
 * 6963 커넥터가 있으면 이 항목을 숨긴다 — "어느 지갑인지 모르는" 버튼은 혼란스럽다.
 *
 * WalletConnect 는 범위에서 제외 (설계서 v1.1).
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
