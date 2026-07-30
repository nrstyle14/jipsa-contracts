import { useState } from "react";
import { Button, Card } from "../ui.js";

/**
 * "왜 Rabby인가" 설명 (2026-07-30 실측 기준).
 *
 * 심사·시연에서 반드시 나오는 질문이다. 근거를 화면에 두지 않으면 "왜 MetaMask를 안 쓰나"에
 * 답할 수 없다. 여기 적는 내용은 전부 실제로 확인한 것만 쓴다 — 추측은 넣지 않는다.
 */
export function WhyRabbyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="text-[11px] text-blue hover:underline"
        onClick={() => setOpen(true)}
      >
        왜 Rabby인가요?
      </button>
      {open && <WhyRabbyModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function WhyRabbyModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="왜 Rabby 지갑인가"
      onClick={onClose}
    >
      <Card
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">왜 Rabby 지갑인가</h2>
            <p className="mt-1 text-[11px] text-muted">
              지갑을 가려서 쓰는 게 아니라, 위임 서명을 허용하는 지갑이 갈립니다.
            </p>
          </div>
          <button className="shrink-0 text-muted hover:text-text" onClick={onClose}>
            닫기
          </button>
        </div>

        <p className="mb-3 text-sm leading-relaxed text-muted">
          JIPSA는 주인이 <b>ERC-7710 위임</b>에 EIP-712로 서명해야 동작합니다. 그런데{" "}
          <b>MetaMask는 이 서명 요청을 정책적으로 거부합니다</b> — 도메인{" "}
          <code className="text-text">DelegationManager</code> 와{" "}
          <code className="text-text">primaryType: Delegation</code> 조합을 알아보고
          이렇게 응답합니다.
        </p>

        <pre className="mb-3 overflow-x-auto rounded-btn border border-line bg-bg p-2.5 text-[11px] leading-relaxed text-muted">
          {`External signature requests cannot sign delegations
for internal accounts.  (code -32603)`}
        </pre>

        <p className="mb-3 text-sm leading-relaxed text-muted">
          MetaMask는 이 흐름을 자사 스마트 계정의 ERC-7715{" "}
          <code className="text-text">wallet_grantPermissions</code> 로만 엽니다. 판단 자체는
          타당합니다 — 위임 서명은 <b>지출 권한을 넘기는 행위</b>인데, 일반 서명 팝업으로 아무
          dapp이나 받을 수 있으면 위험합니다. <b>JIPSA가 하는 주장과 같은 문제의식</b>이고,
          우리는 그 권한을 컨트랙트 레벨 정책으로 묶어 해결합니다.
        </p>

        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-[11px] text-muted">
                <th className="pb-1.5 font-normal">주인이 하는 동작</th>
                <th className="pb-1.5 font-normal">MetaMask</th>
                <th className="pb-1.5 font-normal">Rabby</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <Row action="위임 EIP-712 서명" mm="정책 차단" rb="동작 확인" rbOk />
              <Row action="긴급 철회 · faucet 전송" mm="가능" rb="가능" mmOk rbOk />
              <Row action="EIP-7702 셋업 (type-4)" mm="불가" rb="불가" note="표준 지갑 API 부재 — 공통" />
              <Row action="GIWA 네트워크 추가" mm="가능" rb="버튼으로 자동 추가" mmOk rbOk />
            </tbody>
          </table>
        </div>

        <p className="mb-4 text-[11px] leading-relaxed text-muted">
          Rabby로 발급한 위임이 온체인 검증(서명자 == 위임자 · 정상 결제 시뮬레이션 · 차단 2종)을
          전부 통과하고 실제 결제까지 성공하는 것을 확인했습니다. 7702 셋업만 CLI 1회로 남고,
          나머지 주인 동작은 지갑으로 전부 됩니다.
        </p>

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            이해했습니다
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Row({
  action,
  mm,
  rb,
  mmOk,
  rbOk,
  note,
}: {
  action: string;
  mm: string;
  rb: string;
  mmOk?: boolean;
  rbOk?: boolean;
  note?: string;
}) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3">
        {action}
        {note && <div className="text-[10.5px] text-muted">{note}</div>}
      </td>
      <td className={`py-1.5 pr-3 ${mmOk ? "" : "text-[#E8A6A1]"}`}>{mm}</td>
      <td className={`py-1.5 ${rbOk ? "text-[#7FD39B]" : "text-[#E8A6A1]"}`}>{rb}</td>
    </tr>
  );
}
