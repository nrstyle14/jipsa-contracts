import { defineChain } from "viem";
import { CHAIN_ID, EXPLORER_URL, FLASHBLOCKS_RPC_URL, RPC_URL } from "@jipsa/delegation";

/**
 * GIWA Sepolia.
 *
 * 기본 RPC는 Flashblocks 엔드포인트를 쓴다 — Dojang 검증이 EAS 스토리지를 많이
 * 읽어 일반 RPC는 HTTP 429가 잦다 (2026-07-28 실측).
 * `VITE_RPC_URL`로 덮어쓸 수 있다.
 */
export const giwaSepolia = defineChain({
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL ?? FLASHBLOCKS_RPC_URL] },
  },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
});

export const FALLBACK_RPC_URL = RPC_URL;
export { FLASHBLOCKS_RPC_URL };

export function explorerTx(hash: string) {
  return `${EXPLORER_URL}/tx/${hash}`;
}
export function explorerAddress(addr: string) {
  return `${EXPLORER_URL}/address/${addr}`;
}
