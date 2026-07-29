import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";

/**
 * up.id 역조회 — 주소를 사람이 읽는 이름으로 표기한다.
 *
 * up.id는 **이더리움 메인넷 ENS의 서브도메인**이다 (`username.up.id`). GIWA 체인의
 * 컨트랙트가 아니므로 GIWA RPC로는 조회할 수 없고 메인넷 클라이언트가 따로 필요하다.
 * 해석은 ERC-3668 CCIP-Read로 오프체인 게이트웨이(`https://id.giwa.io/gateway/…`)를
 * 거치는데 viem은 이를 기본 지원한다 (`cast`는 따라가지 않아 실패한다 — 실측).
 *
 * 출처: https://docs.giwa.io/giwa-ecosystem/up-id · https://docs.ens.domains/web/resolution/
 *
 * ⚠️ **데모 EOA에는 등록된 이름이 없다.** `up.id` 도메인은 메인넷에 실재하지만
 *    (소유자 `0x5332F555bbEb38D04a29E6d9F629e4cd04e2c570`), 이름은 지갑에 묶인 SBT로
 *    발급되므로 테스트넷 데모 주소로 돌릴 수 없다. 그래서 대개 `undefined`를 돌려주고
 *    호출부는 축약 주소로 폴백한다. 이름이 있는 주소면 그대로 표시된다
 *    (`vitalik.eth` 양방향 해석으로 경로 검증, 2026-07-29).
 *
 * ⚠️ 역조회 결과는 **정방향으로 다시 확인**한다. ENS 역방향 레코드는 누구나 임의 이름으로
 *    설정할 수 있어 확인 없이 믿으면 사칭 표시가 된다 (ENS 문서 권고사항).
 */
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"),
});

export function useUpId(address: Address | undefined): string | undefined {
  const q = useQuery({
    queryKey: ["upid", address],
    enabled: Boolean(address),
    // 이름은 거의 바뀌지 않는다 — 메인넷 조회를 아낀다
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      const name = await mainnetClient.getEnsName({ address: address as Address });
      if (!name) return null;

      // 정방향 재확인 — 역방향만 믿으면 사칭이 가능하다
      const forward = await mainnetClient.getEnsAddress({ name });
      if (!forward || forward.toLowerCase() !== address!.toLowerCase()) return null;
      return name;
    },
  });

  return q.data ?? undefined;
}
