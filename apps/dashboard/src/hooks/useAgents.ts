import { useReadContract } from "wagmi";
import { ABI, ADDR } from "@jipsa/delegation";
import type { Address } from "viem";
import { useViewer } from "../viewer.js";

/**
 * 주인에게 바인딩된 에이전트 목록 (사이드바 카드).
 *
 * 연결 계정이 아니라 **viewer 주소**로 조회한다 — 읽기 전용 열람 모드에서도
 * 데모 계정의 에이전트가 보여야 한다 (지시서 v1.1 추가 A).
 */
export function useAgents() {
  const { address } = useViewer();
  const q = useReadContract({
    address: ADDR.bindingRegistry,
    abi: ABI.ownerBindingRegistry,
    functionName: "agentsOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5_000 },
  });
  return { agents: (q.data as Address[] | undefined) ?? [], isLoading: q.isLoading };
}

/** 특정 에이전트의 바인딩 상태 — 확정/대기/책임귀속 */
export function useAgentBinding(agent: Address | undefined) {
  const owner = useReadContract({
    address: ADDR.bindingRegistry,
    abi: ABI.ownerBindingRegistry,
    functionName: "ownerOf",
    args: agent ? [agent] : undefined,
    query: { enabled: Boolean(agent), refetchInterval: 5_000 },
  });
  const pending = useReadContract({
    address: ADDR.bindingRegistry,
    abi: ABI.ownerBindingRegistry,
    functionName: "pendingOwnerOf",
    args: agent ? [agent] : undefined,
    query: { enabled: Boolean(agent), refetchInterval: 5_000 },
  });
  const accountable = useReadContract({
    address: ADDR.bindingRegistry,
    abi: ABI.ownerBindingRegistry,
    functionName: "isAccountableAgent",
    args: agent ? [agent] : undefined,
    query: { enabled: Boolean(agent), refetchInterval: 5_000 },
  });

  return {
    owner: owner.data as Address | undefined,
    pendingOwner: pending.data as Address | undefined,
    /** 검증된 주인에게 귀속된 상태인가 — 가맹처가 결제 수락 전 보는 값 */
    isAccountable: accountable.data as boolean | undefined,
  };
}
