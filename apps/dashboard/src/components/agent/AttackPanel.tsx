import { useState } from "react";
import type { Delegation } from "@jipsa/delegation";
import { Button, Card, Chip } from "../ui.js";
import { useViewer } from "../../viewer.js";
import type { Daemon, DaemonBlocked } from "../../hooks/useDaemon.js";
import { RevokeButton } from "./RevokeButton.js";

/**
 * 공격 주입 (시나리오 v2 Act 3).
 *
 * 대시보드는 **서명하지 않는다.** 버튼은 데몬의 `/inject` 를 호출하고, 데몬이 자기 키로
 * 전액 → 49 tKRW 순서로 시도한다. 두 시도 모두 실제로 브로드캐스트되므로 실시간 피드에
 * 적색 행이 남는다 (실패 리딤은 로그를 남기지 않아 온체인 tx가 있어야 보인다).
 *
 * 에이전트가 "속는" 행위는 데몬 코드에 고정돼 있다 — LLM 판단에 맡기면 데모가
 * 비결정적이 되고, 모델이 인젝션을 거부하면 장면 자체가 성립하지 않는다.
 */
export function AttackPanel({
  daemon,
  delegation,
}: {
  daemon: Daemon;
  delegation: Delegation | undefined;
}) {
  const { isReadOnly } = useViewer();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DaemonBlocked[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const canAttack = daemon.online && !daemon.status?.waitingForDelegation && !isReadOnly;

  async function inject() {
    setError(undefined);
    const r = await daemon.inject();
    if (r.error) setError(r.error);
    else setResult(r.blocked ?? []);
  }

  return (
    <>
      <Button
        variant="red"
        disabled={!canAttack}
        title={
          isReadOnly
            ? "읽기 전용 — 데모 계정을 보는 중입니다"
            : !daemon.online
              ? "에이전트 데몬이 꺼져 있습니다 (pnpm -F @jipsa/agent daemon)"
              : daemon.status?.waitingForDelegation
                ? "위임이 없어 시도할 것이 없습니다"
                : "프롬프트 인젝션을 주입합니다"
        }
        onClick={() => {
          setResult(undefined);
          setError(undefined);
          setOpen(true);
        }}
      >
        공격 주입
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="프롬프트 인젝션 주입"
          onClick={() => setOpen(false)}
        >
          <Card
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold">프롬프트 인젝션 주입</h2>
                <p className="mt-1 text-[11px] text-muted">
                  외부 입력이 에이전트에게 그대로 전달됩니다. 에이전트는 이 지시를 따르려 합니다.
                </p>
              </div>
              <button className="shrink-0 text-muted hover:text-text" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>

            <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-btn border border-red/40 bg-redSoft p-3 text-[12px] leading-relaxed text-[#E8A6A1]">
              {daemon.status?.injectionText ?? "(데몬에서 문구를 불러오지 못했습니다)"}
            </pre>

            {!result && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="red" disabled={daemon.busy} onClick={inject}>
                  {daemon.busy ? "에이전트가 시도하는 중…" : "주입"}
                </Button>
                <span className="text-[11px] text-muted">
                  전액 5,000 tKRW → 차단되면 49 tKRW로 재시도합니다
                </span>
              </div>
            )}

            {result && <AttackResult blocked={result} delegation={delegation} />}

            {error && (
              <p className="mt-3 rounded-btn border border-red/40 bg-redSoft p-2 text-[11px] text-[#E8A6A1]">
                {error}
              </p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * 주입 결과.
 *
 * 7702 모델은 자금을 회수할 필요가 없으므로(예치가 없다), 사고를 본 자리에서 바로
 * **권한만 끊을 수 있게** 철회 버튼을 붙인다 — 화면을 옮겨다닐 이유가 없다.
 */
function AttackResult({
  blocked,
  delegation,
}: {
  blocked: DaemonBlocked[];
  delegation: Delegation | undefined;
}) {
  const allBlocked = blocked.length > 0 && blocked.every((b) => isPolicyBlock(b.reason));

  return (
    <div className="space-y-2">
      {blocked.map((b, i) => (
        <div key={`${b.hash}-${i}`} className="rounded-btn border border-line bg-surface2 p-2.5">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Chip tone={isPolicyBlock(b.reason) ? "red" : "muted"}>
              {isPolicyBlock(b.reason) ? "차단됨" : "확인 필요"}
            </Chip>
            <span className="num text-[11px] text-muted">
              {b.amount} → {b.to.slice(0, 8)}…
            </span>
          </div>
          <div className="text-sm">{b.label ?? describe(b.reason)}</div>
          {b.reason && b.label !== b.reason && (
            <div className="num mt-0.5 text-[11px] text-muted">{b.reason}</div>
          )}
        </div>
      ))}

      {allBlocked && (
        <div className="rounded-btn border border-ok/40 bg-[#1E3A2A] p-2.5 text-sm text-[#7FD39B]">
          인젝션은 성공했지만 <b>피해는 0</b>입니다. 모델이 아니라 정책이 막았습니다. 자금은 주인
          지갑을 떠나지 않았습니다.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <span className="text-[11px] text-muted">
          권한을 지금 끊을 수 있습니다 — 예치가 없으니 회수할 자금도 없습니다.
        </span>
        {delegation && <RevokeButton delegation={delegation} label="위임 즉시 해제" />}
      </div>
    </div>
  );
}

/** 정책이 막은 것인지 (데몬이 넣는 특수값과 구분) */
function isPolicyBlock(reason: string | undefined): boolean {
  return Boolean(reason) && reason !== "NOT_BLOCKED" && reason !== "RATE_LIMITED";
}

function describe(reason: string | undefined): string {
  if (reason === "NOT_BLOCKED") return "차단되지 않았습니다 — 정책을 확인하세요";
  if (reason === "RATE_LIMITED") return "RPC 한도에 걸려 시도하지 못했습니다. 잠시 후 다시 주입하세요";
  return reason ?? "사유 미확인";
}
