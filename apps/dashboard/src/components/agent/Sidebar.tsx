import type { Address } from "viem";
import type { Delegation } from "@jipsa/delegation";
import { useAgentBinding, useAgents } from "../../hooks/useAgents.js";
import { useSpend } from "../../hooks/useSpend.js";
import { useAgentLabels } from "../../hooks/useAgentLabels.js";
import { useViewer } from "../../viewer.js";
import { Button, Card, Chip, shortAddr } from "../ui.js";

export function Sidebar({
  selected,
  onSelect,
  onRegister,
  delegation,
}: {
  selected: Address | undefined;
  onSelect: (a: Address) => void;
  onRegister: () => void;
  /** 불러온 위임 — 카드 상태를 판정하는 데 쓴다 (없으면 "위임 없음") */
  delegation: Delegation | undefined;
}) {
  const { agents, isLoading } = useAgents();
  const { labelOf } = useAgentLabels();
  const { isReadOnly } = useViewer();

  return (
    <aside className="w-full shrink-0 space-y-3 md:w-72">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-muted">내 에이전트</h2>
        <Button onClick={onRegister} disabled={isReadOnly} title={isReadOnly ? "읽기 전용 — 데모 계정을 보는 중입니다" : undefined}>
          + 등록
        </Button>
      </div>

      {isLoading && <Card className="text-sm text-muted">불러오는 중…</Card>}

      {!isLoading && agents.length === 0 && (
        <Card className="text-sm text-muted">
          <b className="block text-text">첫 번째 집사를 등록하세요</b>
          바인딩된 에이전트가 없습니다.
          <Button
            className="mt-2"
            variant="primary"
            onClick={onRegister}
            disabled={isReadOnly}
            title={isReadOnly ? "읽기 전용 — 데모 계정을 보는 중입니다" : undefined}
          >
            에이전트 등록
          </Button>
        </Card>
      )}

      {agents.map((a) => (
        <AgentCard
          key={a}
          agent={a}
          label={labelOf(a)}
          selected={selected === a}
          delegation={delegation}
          onSelect={() => onSelect(a)}
        />
      ))}
    </aside>
  );
}

/**
 * 에이전트 카드.
 *
 * 상태 배지는 **온체인·위임에서 유도한다.** 예전에는 "동작 중"이 하드코딩이라
 * 철회된 위임이든 미귀속이든 전부 초록으로 보였다 — 데모에서 근거를 물으면 답이 없다.
 * 대시보드는 에이전트 프로세스가 떠 있는지 알 수 없으므로, "동작 중"의 뜻을
 * **지금 이 에이전트가 실제로 쓸 수 있는 상태인가**로 정의한다.
 */
function AgentCard({
  agent,
  label,
  selected,
  delegation,
  onSelect,
}: {
  agent: Address;
  label: string;
  selected: boolean;
  delegation: Delegation | undefined;
  onSelect: () => void;
}) {
  const binding = useAgentBinding(agent);
  const mine = Boolean(delegation && delegation.delegate.toLowerCase() === agent.toLowerCase());
  const spend = useSpend(mine ? delegation : undefined);
  const status = agentStatus(binding.isAccountable, mine, spend.disabled, spend.policy?.validUntil);

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-card border p-3 text-left transition ${
        selected ? "border-blue bg-surface2" : "border-line bg-surface hover:border-blue/60"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold">{label}</span>
        <Chip tone={status.tone}>{status.text}</Chip>
      </div>
      <span className="num text-[11px] text-muted">{shortAddr(agent)}</span>
    </button>
  );
}

/** 상태 판정 — 위에서 아래로 먼저 걸리는 것이 표시된다 */
function agentStatus(
  isAccountable: boolean | undefined,
  hasDelegation: boolean,
  disabled: boolean | undefined,
  validUntil: number | undefined,
): { text: string; tone: "ok" | "red" | "muted" } {
  if (isAccountable === undefined) return { text: "확인 중…", tone: "muted" };
  if (!isAccountable) return { text: "미귀속", tone: "red" };
  if (!hasDelegation) return { text: "위임 없음", tone: "muted" };
  if (disabled === true) return { text: "정지됨", tone: "red" };
  if (validUntil !== undefined && validUntil * 1000 < Date.now()) {
    return { text: "만료", tone: "red" };
  }
  // 귀속 + 유효한 위임 + 철회 아님 = 지금 결제할 수 있다
  return { text: "동작 중", tone: "ok" };
}
