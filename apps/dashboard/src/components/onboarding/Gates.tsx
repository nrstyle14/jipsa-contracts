import { useState } from "react";
import { ADDR } from "@jipsa/delegation";
import { Button, Card } from "../ui.js";
import { expectedDelegationCode } from "../../hooks/useAccountStatus.js";
import { WhyDelegationAccountModal } from "./WhyDelegationAccount.js";

export function ConnectGate({
  onConnect,
  onViewDemo,
}: {
  onConnect: () => void;
  onViewDemo: () => void;
}) {
  return (
    <Card className="mx-auto mt-16 max-w-md text-center">
      <h2 className="mb-2 text-lg font-bold">지갑을 연결하세요</h2>
      <p className="mb-4 text-sm text-muted">
        주인 지갑을 연결하면 도장 상태와 에이전트 목록을 불러옵니다.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={onConnect}>
          MetaMask 연결
        </Button>
        <Button onClick={onViewDemo}>데모 계정 보기</Button>
      </div>
      <p className="mt-3 text-[11px] text-muted">
        지갑이 없어도 데모 계정의 에이전트 · 정책 게이지 · 실시간 피드를 읽기 전용으로 볼 수
        있습니다.
      </p>
    </Card>
  );
}

export function DojangBanner() {
  return (
    <Card className="mb-4 border-red/50">
      <h3 className="mb-1 text-sm font-bold text-[#E8A6A1]">
        Verified Address(도장)가 필요합니다
      </h3>
      <p className="text-sm text-muted">
        JIPSA는 검증된 주인에게만 에이전트를 바인딩합니다. 플레이그라운드에서 도장을 발급받은 뒤
        다시 연결하세요.
      </p>
      <a
        className="mt-2 inline-block text-sm text-blue hover:underline"
        href="https://sepolia-playground.giwa.io"
        target="_blank"
        rel="noreferrer"
      >
        플레이그라운드에서 도장 발급 →
      </a>
    </Card>
  );
}

/**
 * 7702 게이팅 안내 (설계서 v1.1).
 *
 * ⚠️ **개인키 입력란을 절대 두지 않는다.** type-4 authorization 서명은 개인키
 *    접근이 필요해 MetaMask 인젝티드로는 임의 체인에서 불가하므로, CLI 명령을
 *    안내만 한다.
 */
export function DelegationAccountBanner({
  address,
  code,
}: {
  address: string;
  code: string | undefined;
}) {
  const cmd = `cast send ${address} --auth ${ADDR.delegator7702Impl} --private-key $OWNER_PRIVATE_KEY --rpc-url https://sepolia-rpc.giwa.io`;
  const [why, setWhy] = useState(false);
  return (
    <Card className="mb-4 border-red/50">
      {why && <WhyDelegationAccountModal onClose={() => setWhy(false)} />}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-[#E8A6A1]">
          이 지갑은 아직 위임 계정이 아닙니다
        </h3>
        <button
          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-blue hover:text-text"
          onClick={() => setWhy(true)}
        >
          이걸 왜 해야하나요?
        </button>
      </div>
      <p className="mb-3 text-sm text-muted">
        EIP-7702 코드가 심겨야 위임을 발급할 수 있습니다. MetaMask는 임의 체인에서 type-4
        authorization을 서명하지 못하므로 <b>아래 명령을 터미널에서 1회</b> 실행하세요.
        대시보드는 개인키를 받지 않습니다.
      </p>
      <pre className="num overflow-x-auto rounded-btn border border-line bg-bg p-3 text-[11px] leading-relaxed text-muted">
        {cmd}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => void navigator.clipboard.writeText(cmd)}>명령 복사</Button>
        <span className="num text-[11px] text-muted">
          현재 code: {code && code !== "0x" ? code : "(없음)"} · 기대값:{" "}
          {expectedDelegationCode()}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        실행 직후 code가 <code>0x</code>로 보일 수 있습니다 — RPC 반영 지연이며 한 블록 뒤
        다시 확인하면 됩니다.
      </p>
    </Card>
  );
}
