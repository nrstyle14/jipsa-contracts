import { useAccount, useConnect, useDisconnect } from "wagmi";
import { ADDR } from "@jipsa/delegation";
import { useAccountStatus } from "../../hooks/useAccountStatus.js";
import { Button, Chip, fmtTkrw, shortAddr } from "../ui.js";
import { explorerAddress } from "../../config/chain.js";

export function Header() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const s = useAccountStatus();
  const injected = connectors[0];

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-red text-sm font-black text-white">
          집
        </span>
        <span className="text-base font-bold tracking-tight">JIPSA 관제</span>
      </div>

      <Chip tone="blue">GIWA Sepolia · 91342</Chip>

      {isConnected && (
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
            <Chip tone="red">● 위임 계정 아님</Chip>
          )}

          <Chip>{fmtTkrw(s.tkrwBalance)}</Chip>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {isConnected ? (
          <>
            <a
              href={explorerAddress(address!)}
              target="_blank"
              rel="noreferrer"
              className="num text-xs text-blue hover:underline"
            >
              {shortAddr(address)}
            </a>
            <Button onClick={() => disconnect()}>연결 해제</Button>
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

      {/* tKRW faucet 버튼은 M2 (쓰기)에서 붙인다 — 토큰 주소는 여기서 노출해둔다 */}
      <span className="sr-only">tKRW {ADDR.tKRW}</span>
    </header>
  );
}
