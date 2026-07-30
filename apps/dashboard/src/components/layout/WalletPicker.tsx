import { useState } from "react";
import { useConnect, type Connector } from "wagmi";
import { Button } from "../ui.js";

/**
 * 지갑 선택 (EIP-6963).
 *
 * MetaMask 와 Rabby 를 함께 깔면 둘이 `window.ethereum` 을 서로 차지하려 다툰다.
 * 그래서 커넥터를 하나로 고정하면 어느 지갑이 열릴지 예측할 수 없다 — EIP-6963 으로
 * **발견된 지갑을 나열해 사용자가 고르게** 한다. wagmi 는 이 탐색을 기본으로 켠다.
 *
 * ⚠️ 지갑을 고르는 것이 데모에서 중요한 이유: MetaMask 는 dapp 의 위임(Delegation)
 *    서명 요청을 정책적으로 차단한다("External signature requests cannot sign
 *    delegations for internal accounts"). 그 가드가 없는 지갑에서는 Act 1 의 위임
 *    서명이 그대로 동작한다. 어느 지갑으로 서명했는지가 결과를 가른다.
 */
export function WalletPicker({ compact = false }: { compact?: boolean }) {
  const { connect, connectors, isPending } = useConnect();
  const [open, setOpen] = useState(false);

  const list = pickable(connectors);

  // 하나뿐이면 고를 이유가 없다
  if (list.length <= 1) {
    const only = list[0];
    return (
      <Button
        variant="primary"
        disabled={!only || isPending}
        onClick={() => only && connect({ connector: only })}
      >
        {isPending ? "연결 중…" : only ? `${displayName(only)} 연결` : "지갑 없음"}
      </Button>
    );
  }

  if (compact && !open) {
    return (
      <Button variant="primary" disabled={isPending} onClick={() => setOpen(true)}>
        {isPending ? "연결 중…" : "지갑 연결"}
      </Button>
    );
  }

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap justify-center gap-2"}>
      {list.map((c) => (
        <Button
          key={c.uid}
          variant="primary"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            connect({ connector: c });
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            {c.icon && <img src={c.icon} alt="" className="h-4 w-4 rounded" />}
            {displayName(c)}
          </span>
        </Button>
      ))}
      {compact && <Button onClick={() => setOpen(false)}>취소</Button>}
    </div>
  );
}

/**
 * 표시 이름.
 *
 * 일반 `injected` 커넥터의 `name` 은 "Injected" 인데, 화면에 그대로 쓰면 어느 지갑인지
 * 알 수 없는 라벨이 된다 (6963 을 announce 하지 않는 지갑이나 확장이 없는 브라우저에서
 * 이 폴백이 유일한 항목이 된다). 사람이 읽는 말로 바꾼다.
 */
function displayName(c: Connector): string {
  return c.id === "injected" ? "브라우저 지갑" : c.name;
}

/**
 * 보여줄 커넥터 목록.
 *
 * EIP-6963 으로 발견된 지갑이 있으면 이름·아이콘이 있는 그것들만 쓴다. 일반
 * `injected` 커넥터는 "어느 지갑인지 알 수 없는" 항목이라 같이 보이면 혼란스럽다.
 * 6963 을 안 쓰는 지갑만 있는 환경에서는 폴백으로 남는다.
 */
function pickable(connectors: readonly Connector[]): readonly Connector[] {
  const discovered = connectors.filter((c) => c.id !== "injected");
  return discovered.length > 0 ? discovered : connectors;
}
