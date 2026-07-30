import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useAccountStatus } from "../../hooks/useAccountStatus.js";
import { Button, Chip, fmtTkrw, shortAddr } from "../ui.js";
import { explorerAddress } from "../../config/chain.js";
import { FaucetButton } from "./FaucetButton.js";
import { WalletPicker } from "./WalletPicker.js";
import { Logo } from "./Logo.js";
import { giwaSepolia } from "../../config/chain.js";
import { WhyDelegationAccountModal } from "../onboarding/WhyDelegationAccount.js";
import { DEMO_OWNER, useViewer } from "../../viewer.js";
import { useUpId } from "../../hooks/useUpId.js";

export function Header() {
  const { isConnected } = useAccount();
  const viewer = useViewer();
  // 배지·잔액은 조회 대상(viewer) 기준이어야 한다 — 열람 모드에서 내 계정이 아닌 값을 보여준다
  const address = viewer.address;
  const { disconnect } = useDisconnect();
  const s = useAccountStatus();
  const [why, setWhy] = useState(false);
  // 이름이 등록된 주소면 축약 주소 대신 up.id 를 보여준다
  const upId = useUpId(address);

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
      {why && <WhyDelegationAccountModal onClose={() => setWhy(false)} />}
      <div className="flex items-center gap-2.5">
        <Logo className="h-7 w-7 shrink-0 text-red" />
        <span className="text-base font-bold tracking-tight">JIPSA 관제</span>
      </div>

      <ChainChip />

      {viewer.hasTarget && (
        <>
          {/* 도장 배지 — 게이트 조회 결과 */}
          {s.hasStamp === undefined ? (
            <Chip>도장 확인 중…</Chip>
          ) : s.hasStamp ? (
            <Chip tone="ok">● 도장 인증됨</Chip>
          ) : (
            <Chip tone="red">● 도장 없음</Chip>
          )}

          {/* 7702 배지 — 위임 계정인지 */}
          {s.isDelegationAccount === undefined ? (
            <Chip>위임 계정 확인 중…</Chip>
          ) : s.isDelegationAccount ? (
            <Chip tone="ok">● 위임 계정 (7702)</Chip>
          ) : (
            <button
              onClick={() => setWhy(true)}
              title="왜 이 셋업이 필요한지 보기"
              className="rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-blue"
            >
              <Chip tone="red">● 위임 계정 아님 · 왜?</Chip>
            </button>
          )}

          <Chip>{fmtTkrw(s.tkrwBalance)}</Chip>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {viewer.isReadOnly && <Chip tone="blue">읽기 전용</Chip>}
        {isConnected && !viewer.isReadOnly && (
          <Button onClick={() => viewer.setViewAs(DEMO_OWNER)}>데모 계정 보기</Button>
        )}
        {viewer.hasTarget ? (
          <>
            <FaucetButton />
            <a
              href={explorerAddress(address!)}
              target="_blank"
              rel="noreferrer"
              className={`text-xs text-blue hover:underline ${upId ? "" : "num"}`}
              title={address}
            >
              {upId ?? shortAddr(address)}
            </a>
            {isConnected && <Button onClick={() => disconnect()}>연결 해제</Button>}
          </>
        ) : (
          <WalletPicker compact />
        )}
      </div>
    </header>
  );
}

/**
 * 체인 칩 — **고정 문자열이 아니다.**
 *
 * 예전에는 "GIWA Sepolia · 91342"를 그냥 박아뒀다. 지갑이 다른 체인에 있어도 화면은
 * GIWA라고 주장했고, 조회는 우리 전송을 쓰므로 값도 정상으로 보였다 — 서명·전송만
 * 조용히 실패한다. 연결된 지갑의 체인을 그대로 보여주고, 다르면 적색으로 알린다.
 */
function ChainChip() {
  const { isConnected, chainId } = useAccount();
  if (!isConnected || chainId === undefined || chainId === giwaSepolia.id) {
    return <Chip tone="blue">{`${giwaSepolia.name} · ${giwaSepolia.id}`}</Chip>;
  }
  return <Chip tone="red">● 다른 네트워크 · {chainId}</Chip>;
}
