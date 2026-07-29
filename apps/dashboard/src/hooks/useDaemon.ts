import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";

/**
 * 에이전트 데몬의 제어 API (시나리오 v2 Act 2·3).
 *
 * 데몬은 로컬에서만 듣는다(`127.0.0.1`). 대시보드는 **읽기(status)** 와
 * **주입(inject)·즉시 결제(pay-now)** 만 호출하고, 개인키는 주고받지 않는다 —
 * 결제·인젝션 tx의 서명은 전부 데몬이 자기 키로 한다.
 *
 * ⚠️ 데몬이 꺼져 있는 것은 오류가 아니다. 위임 발급만 보여주는 장면에서는 데몬이 없어도
 *    되므로, 연결 실패는 조용히 `offline`으로 다룬다.
 */
const DEFAULT_BASE = "http://127.0.0.1:8787";

export interface DaemonBlocked {
  hash: Hex;
  amount: string;
  to: Address;
  reason?: string;
  label?: string;
}

export interface DaemonStatus {
  agent: Address;
  delegationHash?: Hex;
  waitingForDelegation: boolean;
  intervalMs: number;
  paymentsMade: number;
  lastPaymentAt?: string;
  lastPaymentHash?: Hex;
  rateLimited: boolean;
  lastError?: string;
  lastInjectionAt?: string;
  lastInjectionBlocked: DaemonBlocked[];
  busy: boolean;
  /** 팝업에 그대로 보여줄 인젝션 문구 (데몬의 injection.txt) */
  injectionText: string;
}

export interface Daemon {
  /** 데몬이 살아 있는가 — "동작 중" 배지의 진짜 근거 */
  online: boolean;
  status: DaemonStatus | undefined;
  /** 인젝션 주입 — 차단된 시도 목록을 돌려준다 */
  inject: () => Promise<{ blocked?: DaemonBlocked[]; error?: string }>;
  /** 즉시 1건 결제 (촬영 중 주기를 기다리지 않으려고) */
  payNow: () => Promise<{ ok?: boolean; error?: string }>;
  busy: boolean;
}

export function useDaemon(baseUrl: string = DEFAULT_BASE): Daemon {
  const [status, setStatus] = useState<DaemonStatus | undefined>();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${baseUrl}/status`);
        if (!r.ok) throw new Error(String(r.status));
        const s = (await r.json()) as DaemonStatus;
        if (stop) return;
        setStatus(s);
        setOnline(true);
      } catch {
        if (stop) return;
        // 데몬이 꺼져 있는 정상 상태 — 화면을 깨뜨리지 않는다
        setOnline(false);
      }
    };
    void tick();
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 2_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [baseUrl]);

  const post = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        const r = await fetch(`${baseUrl}${path}`, { method: "POST" });
        return (await r.json()) as { blocked?: DaemonBlocked[]; ok?: boolean; error?: string };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      } finally {
        setBusy(false);
      }
    },
    [baseUrl],
  );

  return {
    online,
    status,
    busy,
    inject: () => post("/inject"),
    payNow: () => post("/pay-now"),
  };
}
