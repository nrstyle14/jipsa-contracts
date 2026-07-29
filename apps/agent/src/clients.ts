import { createPublicClient, createWalletClient, http, nonceManager, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, FLASHBLOCKS_RPC_URL } from "@jipsa/delegation";
import { optionalString, requirePrivateKey } from "./env.js";

/**
 * GIWA Sepolia.
 *
 * 기본은 Flashblocks 엔드포인트 — 일반 RPC는 Dojang 검증이 EAS 스토리지를 많이 읽어
 * HTTP 429가 잦다 (2026-07-28 실측). `RPC_URL`로 덮어쓸 수 있다.
 */
export function giwaChain(): Chain & { rpcUrls: { default: { http: readonly [string] } } } {
  const url = optionalString("RPC_URL") ?? FLASHBLOCKS_RPC_URL;
  return {
    id: CHAIN_ID,
    name: "GIWA Sepolia",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  };
}

/**
 * GIWA용 HTTP 전송 — 일시적 실패를 재시도한다.
 *
 * ⚠️ 공개 RPC는 무거운 호출을 몰아치면 `over rate limit`(JSON-RPC 에러)이나 연결 끊김으로
 *    거절한다. 재시도가 모든 경우를 구제하지는 못하지만(레이트 리밋은 시간이 지나야 회복된다)
 *    일시적 실패로 데모가 죽는 것은 막는다.
 */
function giwaTransport(url: string) {
  return http(url, { retryCount: 5, retryDelay: 1_000 });
}

/** 키 없이 조회만 하는 클라이언트 (e2e·검증 스크립트용) */
export function giwaPublicClient() {
  const chain = giwaChain();
  return createPublicClient({
    chain,
    transport: giwaTransport(chain.rpcUrls.default.http[0]),
    pollingInterval: 1_000,
  });
}

/**
 * 에이전트 키로 지갑·조회 클라이언트를 만든다. 키 값은 어디에도 로그하지 않는다.
 *
 * ⚠️ `nonceManager`를 붙인다. 없으면 연속 전송에서 **`nonce too low`로 죽는다** —
 *    viem이 매 전송마다 `eth_getTransactionCount(pending)`를 묻는데, 직전 tx가
 *    확정된 직후 노드가 아직 이전 값을 돌려주기 때문이다 (GIWA 실측: 3건 연속
 *    결제 중 2번째에서 재현). nonce를 로컬에서 증가시켜 이 경쟁을 없앤다.
 */
export function agentClients(keyName = "AGENT_PRIVATE_KEY") {
  const chain = giwaChain();
  const transport = giwaTransport(chain.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(requirePrivateKey(keyName), { nonceManager });
  return {
    account,
    chain,
    // viem 기본 폴링은 4초다 — 그대로 두면 ~250ms에 확정된 tx도 "4199ms"로 찍혀
    // Flashblocks의 실제 속도를 가린다. 블록 간격(~1초)에 맞춘다.
    //
    // ⚠️ 250ms까지 좁히면 GIWA 공개 RPC가 `over rate limit`으로 거절한다 (실측).
    //    단순 요청 수 제한은 아니다 — `eth_blockNumber`는 10 req/s에서도 통과했으므로
    //    Dojang 검증처럼 무거운 호출의 누적 비용이 걸리는 것으로 보인다.
    //    한 번 걸리면 다음 실행까지 영향이 남으므로 더 좁히지 말 것.
    publicClient: createPublicClient({ chain, transport, pollingInterval: 1_000 }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}
