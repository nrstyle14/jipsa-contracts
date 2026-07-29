import { ADDR } from "@jipsa/delegation";
import { Button, Card } from "../ui.js";

/**
 * "이걸 왜 해야하나요?" — 7702 셋업 1회의 근거를 설명하는 팝업.
 *
 * 심사·시연에서 반드시 나오는 질문 셋을 한 화면에 담는다.
 *  ① 왜 7702를 골랐나 (트레이드오프까지)
 *  ② 기와 월렛에서는 어떻게 되나
 *  ③ ERC-4337로 하면 이 단계가 없어지는데 왜 안 했나
 *
 * ⚠️ 여기 담긴 사실은 소스·온체인으로 확인한 것만 쓴다. 특히
 *    "구현체의 delegationManager는 immutable"은 프레임워크 원본
 *    `EIP7702StatelessDeleGator` 생성자에서 확인한 내용이다.
 */
export function WhyDelegationAccountModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="위임 계정 셋업이 필요한 이유"
      onClick={onClose}
    >
      <Card
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">왜 이 한 번의 셋업이 필요한가</h2>
            <p className="mt-1 text-[11px] text-muted">
              주인 EOA에 EIP-7702 코드를 심는 단계입니다. 이후 모든 동작은 지갑으로 합니다.
            </p>
          </div>
          <button className="shrink-0 text-muted hover:text-text" onClick={onClose}>
            닫기
          </button>
        </div>

        <Section title="① 왜 7702를 골랐나">
          <p>
            대안은 에이전트용 <b>컨트랙트 지갑에 자금을 예치</b>하는 방식이었습니다. 그러면 온보딩에
            예치 단계가 생기고, 피해 상한이 <b>예치액</b>이 됩니다.
          </p>
          <p>
            7702는 <b>주인 EOA가 그대로 위임 계정</b>이 됩니다. 예치가 없어 자금은 계속 주인 지갑에
            있고, 위임은 지출 권한만 줍니다. 그래서 철회에 <b>자금 회수 단계가 없습니다</b> — 끊는
            것은 권한뿐이고 잔액 변동은 0입니다.
          </p>
          <p>
            표준 위에 올라탑니다. ERC-7710 위임 + ERC-7579 실행 모드 + 감사받은 MetaMask
            delegation-framework v1.3.0을 쓰고, 우리가 공급하는 것은 책임을 강제하는 enforcer
            2개(<code>DojangCaveatEnforcer</code>, <code>JipsaPerTxCapEnforcer</code>)뿐입니다.
          </p>
          <Tradeoff>
            예치가 없으니 <b>주인 EOA 잔액 전체가 위임 표면</b>입니다. 실질적 피해 상한은 예치액이
            아니라 caveat(건당 · 일간 · 총예산)이고, 그래서 데모는 개인 지갑이 아닌 전용 EOA를
            씁니다.
          </Tradeoff>
        </Section>

        <Section title="② 기와 월렛에서는">
          <p>
            지갑이 authorization 서명 UI를 제공하면 이 단계는 <b>클릭 한 번</b>으로 끝납니다.
            서명과 전송이 분리돼 있어 트랜잭션은 우리가 대신 보낼 수 있고, 그러면 주인 EOA에 가스용
            ETH도 필요 없습니다.
          </p>
          <p>
            지금 막힌 것은 프로토콜이 아니라 <b>지갑 API</b>입니다. dApp이 7702 authorization을
            요청하는 표준 RPC가 아직 없습니다 — viem도 인젝티드(JSON-RPC) 계정에 대해 이 서명을
            거부합니다. <code>personal_sign</code>으로 우회할 수도 없습니다. authorization은 접두사
            없는 원시 서명이어야 하는데 그 메서드는 접두사를 붙이기 때문입니다.
          </p>
          <p>
            심는 구현체(<code className="num">{ADDR.delegator7702Impl}</code>)는 MetaMask
            프레임워크 <b>원본</b>입니다. 지갑이 이 주소를 가리키게만 해주면 그대로 동작합니다. 단
            구현체의 <code>delegationManager</code>는 <b>immutable</b>이라, 지갑이 자기 배포본을
            쓰면 위임 서명 도메인과 enforcer 상태 조회를 그쪽 매니저 기준으로 맞춰야 합니다.
          </p>
        </Section>

        <Section title="③ ERC-4337로 하면 이 단계가 없어진다">
          <p>
            스마트 계정을 새로 배포하면 7702 authorization이 필요 없습니다. 대신 비용이 돌아옵니다
            — <b>주소가 바뀌고</b>, 자금을 새 계정으로 <b>이전</b>해야 하고(없앴던 온보딩 마찰이
            부활합니다), EntryPoint · 번들러 · paymaster 인프라가 필요합니다.
          </p>
          <p>
            그래서 MVP는 온보딩 마찰이 0인 7702를 택했고, 4337은 로드맵의 <b>에이전트 가스리스
            (paymaster)</b> 항목으로 남겼습니다. 두 방식은 배타적이지 않습니다.
          </p>
        </Section>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            이해했습니다
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="mb-1.5 text-sm font-bold">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** 트레이드오프는 장점과 같은 톤으로 묻지 않는다 — 눈에 보이게 분리한다 */
function Tradeoff({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-btn border border-line bg-surface2 p-2.5 text-[13px]">
      <span className="font-bold text-text">트레이드오프 </span>
      {children}
    </p>
  );
}
