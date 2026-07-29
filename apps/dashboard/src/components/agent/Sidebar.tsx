import type { Address } from "viem";
import type { Delegation } from "@jipsa/delegation";
import { useAgentBinding, useAgents } from "../../hooks/useAgents.js";
import { useSpend } from "../../hooks/useSpend.js";
import { useDaemon } from "../../hooks/useDaemon.js";
import { useAgentLabels } from "../../hooks/useAgentLabels.js";
import { Card, Chip, shortAddr } from "../ui.js";

export function Sidebar({
  selected,
  onSelect,
  delegation,
}: {
  selected: Address | undefined;
  onSelect: (a: Address) => void;
  /** 불러온 위임 — 카드 상태를 판정하는 데 쓴다 (없으면 "위임 없음") */
  delegation: Delegation | undefined;
}) {
  const { agents, isLoading } = useAgents();
  const { labelOf } = useAgentLabels();

  return (
    <aside className="w-full shrink-0 space-y-3 md:w-72">
      {/*
        시나리오 v2: 에이전트는 사전에 바인딩돼 있고 영상은 위임 서명만 다룬다.
        대본에 없는 버튼을 남겨두면 심사위원이 그것부터 누르므로 [+ 등록]을 두지 않는다.
        바인딩이 필요하면 CLI로 한다 (README · 시나리오 문서 참조).
      */}
      <h2 className="text-sm font-bold text-muted">내 에이전트</h2>

      {isLoading && <Card className="text-sm text-muted">불러오는 중…</Card>}

      {!isLoading && agents.length === 0 && (
        <Card className="text-sm text-muted">
          <b className="block text-text">바인딩된 에이전트가 없습니다</b>
          이 주소에 귀속된 에이전트가 없습니다. 바인딩은 CLI로 합니다 —
          <code className="text-text">acceptBinding</code> 은 에이전트가 자기 키로 서명해야
          하므로 대시보드에서 할 수 없습니다.
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
  const daemon = useDaemon();
  const mine = Boolean(delegation && delegation.delegate.toLowerCase() === agent.toLowerCase());
  const spend = useSpend(mine ? delegation : undefined);
  // 데몬이 이 에이전트 주소로 떠 있으면 "동작 중"이 프로세스 생존까지 뜻한다
  const daemonHere =
    daemon.online && daemon.status?.agent.toLowerCase() === agent.toLowerCase();
  const status = agentStatus(
    binding.isAccountable,
    mine,
    spend.disabled,
    spend.policy?.validUntil,
    daemonHere,
  );

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
  daemonOnline: boolean,
): { text: string; tone: "ok" | "red" | "muted" } {
  if (isAccountable === undefined) return { text: "확인 중…", tone: "muted" };
  if (!isAccountable) return { text: "미귀속", tone: "red" };
  if (!hasDelegation) return { text: "위임 없음", tone: "muted" };
  if (disabled === true) return { text: "정지됨", tone: "red" };
  if (validUntil !== undefined && validUntil * 1000 < Date.now()) {
    return { text: "만료", tone: "red" };
  }
  // 여기까지 오면 권한은 온전하다. 실제로 결제가 일어나는지는 데몬 생존이 가른다.
  if (!daemonOnline) return { text: "대기 중", tone: "muted" };
  return { text: "동작 중", tone: "ok" };
}
