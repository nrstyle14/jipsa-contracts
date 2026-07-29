import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAccountStatus } from "../../hooks/useAccountStatus.js";
import { Button, Chip, fmtTkrw, shortAddr } from "../ui.js";
import { explorerAddress } from "../../config/chain.js";
import { FaucetButton } from "./FaucetButton.js";
import { WhyDelegationAccountModal } from "../onboarding/WhyDelegationAccount.js";
import { DEMO_OWNER, useViewer } from "../../viewer.js";
import { useUpId } from "../../hooks/useUpId.js";

export function Header() {
  const { isConnected } = useAccount();
  const viewer = useViewer();
  // 배지·잔액은 조회 대상(viewer) 기준이어야 한다 — 열람 모드에서 내 계정이 아닌 값을 보여준다
  const address = viewer.address;
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const s = useAccountStatus();
  const injected = connectors[0];
  const [why, setWhy] = useState(false);
  // 이름이 등록된 주소면 축약 주소 대신 up.id 를 보여준다
  const upId = useUpId(address);

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
      {why && <WhyDelegationAccountModal onClose={() => setWhy(false)} />}
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-red text-sm font-black text-white">
          집
        </span>
        <span className="text-base font-bold tracking-tight">JIPSA 관제</span>
      </div>

      <Chip tone="blue">GIWA Sepolia · 91342</Chip>

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
          <Button
            variant="primary"
            disabled={!injected || isPending}
            onClick={() => injected && connect({ connector: injected })}
          >
            {isPending ? "연결 중…" : "MetaMask 연결"}
          </Button>
        )}
      </div>
    </header>
  );
}
