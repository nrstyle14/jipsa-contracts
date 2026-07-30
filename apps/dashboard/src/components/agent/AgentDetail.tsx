import type { Address } from "viem";
import { useState } from "react";
import { useAgentBinding } from "../../hooks/useAgents.js";
import { useAgentLabels } from "../../hooks/useAgentLabels.js";
import { useViewer } from "../../viewer.js";
import { useSpend } from "../../hooks/useSpend.js";
import { useAccountStatus } from "../../hooks/useAccountStatus.js";
import type { Delegation } from "@jipsa/delegation";
import { Button, Card, Chip, Gauge, fmtTkrw, shortAddr } from "../ui.js";
import { explorerAddress } from "../../config/chain.js";
import { RevokeButton } from "./RevokeButton.js";
import { AttackPanel } from "./AttackPanel.js";
import { useDaemon } from "../../hooks/useDaemon.js";
import { LiveFeed } from "../feed/LiveFeed.js";

export function AgentDetail({
  agent,
  delegation,
  onImport,
  onClearDelegation,
  importError,
  onIssue,
}: {
  agent: Address;
  delegation: Delegation | undefined;
  onImport: (text: string) => void;
  onClearDelegation: () => void;
  importError: string | undefined;
  /** 이 에이전트에 위임을 새로 발급 (마법사를 ③단계로 열어준다) */
  onIssue: () => void;
}) {
  const binding = useAgentBinding(agent);
  const { labelOf, setLabel } = useAgentLabels();
  const { isReadOnly } = useViewer();
  const daemon = useDaemon();
  const status = useAccountStatus();
  const spend = useSpend(delegation);
  const p = spend.policy;

  const boundToThisDelegation =
    delegation && delegation.delegate.toLowerCase() === agent.toLowerCase();

  return (
    <section className="min-w-0 flex-1 space-y-4">
      <AgentTitle
        key={agent}
        agent={agent}
        label={labelOf(agent)}
        onRename={(name) => setLabel(agent, name)}
      />

      {/* ① 상태 스트립 */}
      <div className="grid grid-cols-2 gap-3 num lg:grid-cols-4">
        <Stat label="주인 tKRW 잔액" value={fmtTkrw(status.tkrwBalance)} hint="위임 표면 (예치 없음)" />
        <Stat
          label="누적 지출"
          value={fmtTkrw(spend.spentTotal)}
          hint={p ? `총예산 ${fmtTkrw(p.totalBudget)}` : "위임 없음"}
        />
        <Stat
          label="오늘 남은 한도"
          value={fmtTkrw(spend.availableToday)}
          hint={p ? `일간 ${fmtTkrw(p.dailyCap)}` : "위임 없음"}
        />
        <Stat
          label="책임지는 사람"
          // 로딩 중(undefined)에 "없음"이라고 단정하면 안 된다 — 화면 첫 순간에
          // 귀속된 에이전트가 미귀속으로 잘못 보인다
          value={
            binding.isAccountable === undefined
              ? "확인 중…"
              : binding.isAccountable
                ? shortAddr(binding.owner)
                : "없음"
          }
          hint={
            binding.isAccountable === undefined
              ? "레지스트리 조회"
              : binding.isAccountable
                ? "온체인에 새겨진 주인 (도장 인증)"
                : "귀속 전에는 결제가 차단됩니다"
          }
        />
      </div>

      <DaemonLine daemon={daemon} />

      {/* ② 정책 패널 */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">위임 정책</h3>
          <div className="flex items-center gap-2">
            {spend.disabled === true && <Chip tone="red">철회됨</Chip>}
            {p?.verifiedRecipientOnly && <Chip tone="ok">검증 수신처 전용</Chip>}
            {delegation && boundToThisDelegation && spend.disabled === false && (
              <>
                <AttackPanel daemon={daemon} delegation={delegation} />
                <RevokeButton delegation={delegation} />
              </>
            )}
          </div>
        </div>

        {!delegation && (
          <NoDelegation
            onImport={onImport}
            error={importError}
            onIssue={onIssue}
            readOnly={isReadOnly}
          />
        )}

        {delegation && !boundToThisDelegation && (
          <p className="text-sm text-[#E8A6A1]">
            불러온 위임의 delegate({shortAddr(delegation.delegate)})가 선택한 에이전트와 다릅니다.
          </p>
        )}

        {delegation && boundToThisDelegation && p && (
          <>
            <Gauge label="건당 한도" used={0n} cap={p.perTxCap} />
            <Gauge
              label="일간 한도 사용"
              used={
                spend.availableToday === undefined ? undefined : p.dailyCap - spend.availableToday
              }
              cap={p.dailyCap}
            />
            <Gauge label="총예산 사용" used={spend.spentTotal} cap={p.totalBudget} />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-muted num">
              <span>만료 {new Date(p.validUntil * 1000).toLocaleString("ko-KR")}</span>
              <span>caveat {delegation.caveats.length}개</span>
              <span>해시 {spend.delegationHash?.slice(0, 10)}…</span>
              <button className="text-blue hover:underline" onClick={onClearDelegation}>
                위임 비우기
              </button>
            </div>
          </>
        )}
      </Card>

      {/* ③ 실시간 지출 피드 */}
      <LiveFeed owner={binding.owner} />

      <p className="text-[11px] text-muted">
        <a
          className="text-blue hover:underline"
          href={explorerAddress(agent)}
          target="_blank"
          rel="noreferrer"
        >
          익스플로러에서 에이전트 활동 보기 →
        </a>
      </p>
    </section>
  );
}

/**
 * 에이전트 이름 — 로컬 라벨이라 여기서 바로 고칠 수 있게 한다.
 * 이름은 표시용이고 신뢰의 근거가 아니다 (근거는 아래 "책임지는 사람" 카드).
 */
function AgentTitle({
  agent,
  label,
  onRename,
}: {
  agent: Address;
  label: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(draft);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="비우면 기본 이름"
          className="rounded-btn border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-blue"
        />
        <Button
          onClick={() => {
            onRename(draft);
            setEditing(false);
          }}
        >
          저장
        </Button>
        <span className="text-[11px] text-muted">이 브라우저에만 저장됩니다</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-bold">{label}</h2>
      <span className="num text-[11px] text-muted">{shortAddr(agent)}</span>
      <button
        className="text-[11px] text-blue hover:underline"
        onClick={() => {
          setDraft(label);
          setEditing(true);
        }}
      >
        이름 변경
      </button>
    </div>
  );
}

/**
 * 데몬 상태 줄.
 *
 * "동작 중" 배지가 무엇을 근거로 하는지 화면에 드러낸다 — 데몬이 꺼져 있으면
 * 에이전트는 아무것도 하지 않으므로, 그 사실이 보여야 한다.
 */
function DaemonLine({ daemon }: { daemon: ReturnType<typeof useDaemon> }) {
  if (!daemon.online) {
    return (
      <p className="text-[11px] text-muted">
        에이전트 데몬이 꺼져 있습니다 — 결제는 일어나지 않습니다.{" "}
        <code className="text-text">pnpm -F @jipsa/agent daemon</code>
      </p>
    );
  }
  const s = daemon.status;
  const seconds = s ? Math.round(s.intervalMs / 1000) : 0;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <Chip tone="ok">데몬 연결됨</Chip>
      <span>
        {seconds}초 주기 · 결제 {s?.paymentsMade ?? 0}건
      </span>
      {s?.waitingForDelegation && <span className="text-[#E8A6A1]">위임 대기 중</span>}
      {s?.pausedReason && (
        <span className="text-[#E8A6A1]">
          주기 결제 멈춤 — {s.pausedReason} (위임을 새로 발급하면 재개됩니다)
        </span>
      )}
      {s?.rateLimited && (
        <span className="text-[#E8A6A1]">RPC 한도 — 지금은 건너뛰고 잠시 후 다시 시도합니다</span>
      )}
      {s?.lastError && !s.rateLimited && <span className="text-[#E8A6A1]">{s.lastError}</span>}
    </p>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-base font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </Card>
  );
}

/**
 * 위임이 아직 없을 때의 안내.
 *
 * 7702 모델에는 정책을 담은 온체인 레코드가 없다 — 정책값은 주인이 서명한 위임의
 * caveat terms 안에만 존재하므로 체인 조회로는 찾을 수 없다. 그래서 두 경로를 준다:
 * 마법사로 새로 서명해 발급하거나(발급 즉시 저장), 이미 발급한 파일을 불러오거나.
 *
 * 문구에서 `delegation.json`을 앞세우지 않는다 — 처음 보는 사람에게 파일명은 아무
 * 정보가 아니다. "위임장"이 무엇인지 먼저 말하고 파일명은 각주로 내린다.
 *
 * 불러오는 파일은 개인키가 아니라 **서명된 공개 산출물**이다.
 */
function NoDelegation({
  onImport,
  error,
  onIssue,
  readOnly,
}: {
  onImport: (text: string) => void;
  error: string | undefined;
  onIssue: () => void;
  readOnly: boolean;
}) {
  return (
    <div className="text-sm text-muted">
      <p className="mb-1 text-text">아직 이 에이전트에 준 지출 권한이 없습니다.</p>
      <p className="mb-3">
        <b>위임장</b>을 만들어야 합니다 — 얼마까지 어디에 쓸 수 있는지를 적고 주인이 서명한
        문서입니다. 이 문서는 체인에 올라가지 않고 파일로 보관하기 때문에, 화면에 정책과 한도를
        보여주려면 그 파일이 필요합니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={onIssue}
          disabled={readOnly}
          title={readOnly ? "읽기 전용 — 데모 계정을 보는 중입니다" : undefined}
        >
          위임장 새로 발급
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-line bg-surface2 px-3 py-2 text-sm hover:border-blue">
          발급한 위임장 파일 불러오기
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onImport(await f.text());
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-[11px]">
        파일 이름은 <code className="text-text">delegation.json</code>이고, 발급할 때 내려받습니다
        (CLI로 발급했다면 <code className="text-text">apps/agent/delegation.json</code>). 개인키가
        아니라 서명된 공개 문서라 열어봐도, 남에게 보여도 안전합니다.
      </p>
      {error && <p className="mt-2 text-[#E8A6A1]">불러오기 실패: {error}</p>}
    </div>
  );
}
