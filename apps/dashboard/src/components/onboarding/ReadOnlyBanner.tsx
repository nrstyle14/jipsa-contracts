import { useAccount, useConnect } from "wagmi";
import { Button, Card, shortAddr } from "../ui.js";
import { useViewer } from "../../viewer.js";

/**
 * 읽기 전용 열람 배너 (지시서 v1.1 추가 A).
 *
 * 남의 주소를 보는 중임을 화면 상단에서 계속 알린다. 이게 없으면 심사위원이
 * 자기 계정을 보고 있다고 착각한 채 "왜 잔액이 있지?"로 읽는다.
 */
export function ReadOnlyBanner() {
  const { viewAs, setViewAs } = useViewer();
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  return (
    <Card className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-blue/40 bg-surface2 py-3">
      <span className="text-sm font-bold text-[#9FC0DA]">읽기 전용 — 데모 계정을 보는 중</span>
      <span className="num text-[11px] text-muted">{shortAddr(viewAs)}</span>
      <span className="text-[11px] text-muted">
        발급 · 철회 · faucet은 잠겨 있습니다. 내 지갑으로 보려면 연결하세요.
      </span>
      <div className="ml-auto flex items-center gap-2">
        {!isConnected && (
          <Button
            variant="primary"
            disabled={!connectors[0]}
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          >
            MetaMask 연결
          </Button>
        )}
        <Button onClick={() => setViewAs(undefined)}>열람 종료</Button>
      </div>
    </Card>
  );
}
