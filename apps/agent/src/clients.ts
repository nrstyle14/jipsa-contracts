import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, FLASHBLOCKS_RPC_URL } from "@jipsa/delegation";
import { optionalString, requirePrivateKey } from "./env.js";

/**
 * GIWA Sepolia.
 *
 * 기본은 Flashblocks 엔드포인트 — 일반 RPC는 Dojang 검증이 EAS 스토리지를 많이 읽어
 * HTTP 429가 잦다 (2026-07-28 실측). `RPC_URL`로 덮어쓸 수 있다.
 */
export function giwaChain(): Chain {
  const url = optionalString("RPC_URL") ?? FLASHBLOCKS_RPC_URL;
  return {
    id: CHAIN_ID,
    name: "GIWA Sepolia",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  };
}

/** 에이전트 키로 지갑·조회 클라이언트를 만든다. 키 값은 어디에도 로그하지 않는다. */
export function agentClients(keyName = "AGENT_PRIVATE_KEY") {
  const chain = giwaChain();
  const transport = http(chain.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(requirePrivateKey(keyName));
  return {
    account,
    chain,
    publicClient: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}
