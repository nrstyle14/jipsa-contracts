import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { DEMO } from "@jipsa/delegation";

const KEY = "jipsa.agentLabels.v1";

/**
 * 에이전트 표시 이름 — **브라우저 로컬 저장**이다.
 *
 * 온체인에는 이름이 없다. `OwnerBindingRegistry`는 주소만 다루고, up.id 같은
 * 이름 레지스트리는 주소·함수를 확인하지 못해 아직 붙이지 않았다 (`useUpId` 스텁 참조).
 * 그래서 이름은 화면 편의를 위한 로컬 라벨이고 신뢰의 근거가 아니다 —
 * 책임의 근거는 레지스트리에 새겨진 주인 주소다.
 *
 * ⚠️ 라벨은 기기·브라우저마다 다르다. 다른 기기에서 열면 기본 이름으로 보인다.
 *
 * @dev 상태를 훅 안에 두면 안 된다. 사이드바와 상세 화면이 각자 인스턴스를 갖게 되어
 *      한쪽에서 이름을 바꿔도 다른 쪽이 모른다 (실제로 그랬다). 그래서 모듈 단위
 *      스토어 하나를 두고 `useSyncExternalStore`로 모든 구독자에게 함께 알린다.
 */
type Labels = Record<string, string>;

let cache: Labels | null = null;
const listeners = new Set<() => void>();

function snapshot(): Labels {
  if (cache === null) {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
      cache = parsed && typeof parsed === "object" ? (parsed as Labels) : {};
    } catch {
      // 깨진 값이 남아 이름이 계속 실패하지 않도록 지운다
      localStorage.removeItem(KEY);
      cache = {};
    }
  }
  return cache;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 빈 문자열을 넣으면 기본 이름으로 되돌린다 */
export function setAgentLabel(agent: Address, name: string): void {
  const next = { ...snapshot() };
  const key = agent.toLowerCase();
  const trimmed = name.trim();
  if (trimmed) next[key] = trimmed;
  else delete next[key];

  cache = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  for (const fn of listeners) fn();
}

export function useAgentLabels() {
  const labels = useSyncExternalStore(subscribe, snapshot, snapshot);

  const labelOf = useCallback(
    (agent: Address | undefined) => {
      if (!agent) return "";
      return labels[agent.toLowerCase()] ?? defaultLabel(agent);
    },
    [labels],
  );

  return { labelOf, setLabel: setAgentLabel };
}

/**
 * 이름을 정하지 않았을 때 — 주소 뒷자리로 서로 구분되게 한다.
 *
 * 데모 에이전트만 예외로 "리서치봇"이다. MVP 시나리오 Act 1의 대본이
 * "대시보드에 리서치봇 카드 생성"이라 화면 문구가 대본과 어긋나면 안 된다.
 */
export function defaultLabel(agent: Address): string {
  if (agent.toLowerCase() === DEMO.agent.toLowerCase()) return "리서치봇";
  return `에이전트 ${agent.slice(-4)}`;
}
