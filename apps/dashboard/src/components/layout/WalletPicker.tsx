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
  // MetaMask 만 깔려 있으면 고를 것이 없다 — 이유를 말해야 막다른 길이 되지 않는다
  const onlyMetaMask = list.length === 0 && connectors.some(isMetaMask);

  if (onlyMetaMask) {
    return (
      <span className="text-[11px] text-[#E8A6A1]">
        쓸 수 있는 지갑이 없습니다 — MetaMask는 위임 서명을 거부해 제외했습니다. Rabby를
        설치하세요.
      </span>
    );
  }

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
 * MetaMask 인가.
 *
 * EIP-6963 은 `rdns`(= wagmi 의 커넥터 id)로 지갑을 식별한다. 이름도 함께 보는 이유는
 * 배포판에 따라 id 가 다를 수 있어서다 — 하나만 보면 놓친다.
 */
function isMetaMask(c: Connector): boolean {
  return /metamask/i.test(c.id) || /metamask/i.test(c.name);
}

/**
 * 보여줄 커넥터 목록.
 *
 * ⚠️ **MetaMask 는 목록에서 제외한다.** 연결은 되지만 위임 EIP-712 서명을 정책적으로
 *    거부하므로(`External signature requests cannot sign delegations for internal
 *    accounts`), 고를 수 있게 두면 반드시 그것부터 눌러 보고 Act 1 에서 막힌다.
 *    라벨만 지우는 것으로는 부족했다 — 6963 으로 발견되면 이름이 그대로 뜬다.
 *
 * EIP-6963 으로 발견된 지갑이 있으면 이름·아이콘이 있는 그것들만 쓴다. 일반 `injected`
 * 커넥터는 "어느 지갑인지 알 수 없는" 항목이라 같이 보이면 혼란스럽고, 6963 을 안 쓰는
 * 지갑만 있는 환경에서는 폴백으로 남는다.
 */
function pickable(connectors: readonly Connector[]): readonly Connector[] {
  const announced = connectors.filter((c) => c.id !== "injected");
  const usable = announced.filter((c) => !isMetaMask(c));
  if (usable.length > 0) return usable;

  // ⚠️ 6963 에 MetaMask 만 있으면 일반 `injected` 폴백도 **같은 MetaMask** 다
  //    (`window.ethereum` 이 그것이다). 이걸 남기면 "브라우저 지갑 연결" 로 MetaMask 가
  //    뒷문으로 연결된다 — 목록에서 지운 의미가 없어진다.
  //    `window.ethereum.isMetaMask` 로 판별하지 않는 이유: Rabby 도 호환을 위해 그 플래그를
  //    참으로 둬서 신뢰할 수 없다.
  if (announced.some(isMetaMask)) return [];

  // 6963 을 announce 하지 않는 지갑만 있는 환경 — 폴백을 남긴다
  return connectors.filter((c) => !isMetaMask(c));
}
