import type { Address } from "viem";
import { useAgents } from "../../hooks/useAgents.js";
import { Button, Card, Chip, shortAddr } from "../ui.js";

export function Sidebar({
  selected,
  onSelect,
}: {
  selected: Address | undefined;
  onSelect: (a: Address) => void;
}) {
  const { agents, isLoading } = useAgents();

  return (
    <aside className="w-full shrink-0 space-y-3 md:w-72">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-muted">내 에이전트</h2>
        {/* 등록 마법사는 M2 */}
        <Button disabled title="M2에서 활성화">
          + 등록
        </Button>
      </div>

      {isLoading && <Card className="text-sm text-muted">불러오는 중…</Card>}

      {!isLoading && agents.length === 0 && (
        <Card className="text-sm text-muted">
          <b className="block text-text">첫 번째 집사를 등록하세요</b>
          바인딩된 에이전트가 없습니다.
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
            <span className="text-sm font-bold">리서치봇</span>
            <Chip tone="ok">동작 중</Chip>
          </div>
          <span className="num text-[11px] text-muted">{shortAddr(a)}</span>
        </button>
      ))}
    </aside>
  );
}
