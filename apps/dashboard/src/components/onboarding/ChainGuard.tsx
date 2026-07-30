import { useAccount, useSwitchChain } from "wagmi";
import { Button, Card } from "../ui.js";
import { giwaSepolia } from "../../config/chain.js";

/**
 * 체인 불일치 안내 — 지갑이 GIWA Sepolia 가 아닐 때.
 *
 * 조회는 우리 `http()` 전송을 쓰므로 지갑이 어느 체인이든 화면이 채워진다. 그래서
 * 불일치가 조용히 숨는다 — 그런데 **쓰기와 서명은 지갑의 활성 체인을 따른다**:
 *  · `disableDelegation`·faucet 같은 writeContract 는 체인이 다르면 실패한다
 *  · 위임 EIP-712 서명은 도메인에 `chainId: 91342` 가 박혀 있어, 지갑이 다른 체인에
 *    있으면 "도메인 chainId 가 활성 체인과 다르다"며 거부하는 지갑이 많다
 *
 * Rabby 처럼 GIWA 를 기본 목록에 갖고 있지 않은 지갑도 있으므로, 수동 RPC 입력을
 * 요구하지 않고 `wallet_switchEthereumChain` → (미등록이면) `wallet_addEthereumChain`
 * 으로 이어지는 wagmi 의 전환을 버튼 하나로 제공한다.
 */
export function ChainGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  if (!isConnected || chainId === undefined || chainId === giwaSepolia.id) return null;

  return (
    <Card className="mb-4 border-red/50">
      <h3 className="mb-1 text-sm font-bold text-[#E8A6A1]">지갑이 다른 네트워크에 있습니다</h3>
      <p className="mb-3 text-sm text-muted">
        연결된 지갑의 체인이 <b>{chainId}</b> 입니다. 서명과 전송은 지갑의 활성 체인을 따르므로
        위임 서명·철회가 실패합니다. 화면의 잔액·에이전트는 GIWA에서 직접 읽고 있어 정상으로
        보일 수 있습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={isPending}
          onClick={() => switchChain({ chainId: giwaSepolia.id })}
        >
          {isPending ? "전환 요청 중…" : `${giwaSepolia.name} 으로 전환`}
        </Button>
        <span className="text-[11px] text-muted">
          네트워크가 없으면 지갑에 추가하라는 창이 함께 뜹니다 (RPC를 손으로 넣지 않아도 됩니다)
        </span>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-[#E8A6A1]">
          {error.message.split("\n")[0]} — 지갑에서 직접 추가해야 할 수 있습니다: 체인 ID{" "}
          {giwaSepolia.id} · RPC {giwaSepolia.rpcUrls.default.http[0]}
        </p>
      )}
    </Card>
  );
}
