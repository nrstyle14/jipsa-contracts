import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { DEMO } from "@jipsa/delegation";

/**
 * "누구의 화면을 보고 있는가" — 조회 주소를 한 곳에서 결정한다 (지시서 v1.1 추가 A).
 *
 * 심사위원이 지갑 없이도 데모 계정의 에이전트·게이지·실시간 피드를 열람할 수 있어야 한다.
 * 그래서 조회 대상 주소를 연결 계정과 분리했다.
 *
 * ⚠️ `viewAs`가 설정되면 **읽기 전용**이다. 남의 주소를 보는 중에 쓰기 버튼이 살아 있으면
 *    화면에 보이는 계정과 서명하는 계정이 달라져 사고가 난다 — 발급·철회·faucet을 모두 막는다.
 *    연결 계정과 같은 주소를 viewAs로 넣은 경우도 예외를 두지 않는다 (규칙이 단순해야 안전하다).
 */
export interface Viewer {
  /** 모든 조회가 사용할 주소 — viewAs가 있으면 그 주소, 없으면 연결 계정 */
  address: Address | undefined;
  /** 화면에 무언가 표시할 수 있는 상태인가 (연결됐거나 열람 모드) */
  hasTarget: boolean;
  /** 쓰기 금지 여부 */
  isReadOnly: boolean;
  /** 열람 중인 주소 (열람 모드가 아니면 undefined) */
  viewAs: Address | undefined;
  /** 열람 모드 진입·해제. URL의 `?viewAs=`도 함께 맞춘다 */
  setViewAs: (a: Address | undefined) => void;
}

const ViewerContext = createContext<Viewer | undefined>(undefined);

/** URL에서 `?viewAs=`를 읽는다 — 주소 형식이 아니면 무시한다 */
function viewAsFromUrl(): Address | undefined {
  const raw = new URLSearchParams(window.location.search).get("viewAs");
  return raw && isAddress(raw) ? (raw as Address) : undefined;
}

/** 공유 가능한 링크가 되도록 URL을 현재 상태에 맞춘다 (히스토리는 늘리지 않는다) */
function syncUrl(a: Address | undefined): void {
  const url = new URL(window.location.href);
  if (a) url.searchParams.set("viewAs", a);
  else url.searchParams.delete("viewAs");
  window.history.replaceState(null, "", url);
}

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const { address: connected } = useAccount();
  const [viewAs, setViewAsState] = useState<Address | undefined>(() => viewAsFromUrl());

  // 뒤로/앞으로 이동에도 링크가 맞게 동작해야 한다
  useEffect(() => {
    const onPop = () => setViewAsState(viewAsFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setViewAs = useCallback((a: Address | undefined) => {
    setViewAsState(a);
    syncUrl(a);
  }, []);

  const value = useMemo<Viewer>(
    () => ({
      address: viewAs ?? connected,
      hasTarget: Boolean(viewAs ?? connected),
      isReadOnly: Boolean(viewAs),
      viewAs,
      setViewAs,
    }),
    [viewAs, connected, setViewAs],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  const v = useContext(ViewerContext);
  if (!v) throw new Error("useViewer는 ViewerProvider 안에서만 쓸 수 있습니다.");
  return v;
}

/** 심사위원에게 전달하는 데모 계정 */
export const DEMO_OWNER: Address = DEMO.owner;
