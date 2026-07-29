import type { Address } from "viem";
import { useAgents } from "../../hooks/useAgents.js";
import { useAgentLabels } from "../../hooks/useAgentLabels.js";
import { useViewer } from "../../viewer.js";
import { Button, Card, Chip, shortAddr } from "../ui.js";

export function Sidebar({
  selected,
  onSelect,
  onRegister,
}: {
  selected: Address | undefined;
  onSelect: (a: Address) => void;
  onRegister: () => void;
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
        <button
          key={a}
          onClick={() => onSelect(a)}
          className={`w-full rounded-card border p-3 text-left transition ${
            selected === a ? "border-blue bg-surface2" : "border-line bg-surface hover:border-blue/60"
          }`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="truncate text-sm font-bold">{labelOf(a)}</span>
            <Chip tone="ok">동작 중</Chip>
          </div>
          <span className="num text-[11px] text-muted">{shortAddr(a)}</span>
        </button>
      ))}
    </aside>
  );
}
