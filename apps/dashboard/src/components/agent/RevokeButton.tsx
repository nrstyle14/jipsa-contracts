import { useState } from "react";
import type { Delegation } from "@jipsa/delegation";
import { useDelegationProvider } from "../../hooks/useDelegationProvider.js";
import { useViewer } from "../../viewer.js";
import { Button } from "../ui.js";
import { explorerTx } from "../../config/chain.js";

/**
 * 긴급 철회 — `DelegationManager.disableDelegation` 직접 호출 (설계서 v1.1).
 *
 * 7702 모델이라 **자금 회수 단계가 없다.** tKRW는 처음부터 주인 EOA 잔액이었고
 * 위임은 지출 권한만 부여했다. 끊는 것은 권한뿐이다.
 */
export function RevokeButton({
  delegation,
  label = "긴급 철회",
}: {
  delegation: Delegation;
  /** 버튼 문구 — 공격 결과 팝업에서는 "위임 즉시 해제"로 부른다 */
  label?: string;
}) {
  const { isReadOnly } = useViewer();
  const provider = useDelegationProvider();
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  async function revoke() {
    if (!provider) return;
    setBusy(true);
    setError(undefined);
    try {
      setHash(await provider.revokeDelegation(delegation));
      setConfirming(false);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  if (hash) {
    return (
      <a
        className="num text-[11px] text-ok hover:underline"
        href={explorerTx(hash)}
        target="_blank"
        rel="noreferrer"
      >
        철회 전송됨 ↗
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {confirming ? (
        <>
          <span className="text-[11px] text-muted">에이전트 지출을 즉시 중단합니다.</span>
          <Button variant="red" disabled={busy} onClick={revoke}>
            {busy ? "서명 대기…" : "확인"}
          </Button>
          <Button onClick={() => setConfirming(false)}>취소</Button>
        </>
      ) : (
        <Button
          variant="red"
          disabled={isReadOnly}
          title={isReadOnly ? "읽기 전용 — 데모 계정을 보는 중입니다" : undefined}
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      )}
      {error && <span className="text-[11px] text-[#E8A6A1]">{error}</span>}
    </div>
  );
}
