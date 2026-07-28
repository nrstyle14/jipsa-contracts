import { useAccount, useBalance, useReadContract } from "wagmi";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ABI, ADDR } from "@jipsa/delegation";
import type { Address, Hex } from "viem";

/**
 * 연결된 계정의 상태 — 배지 3개(도장 · 7702 · tKRW)의 데이터 원천.
 */
export interface AccountStatus {
  /** Dojang 도장 보유 여부 (우리 게이트 판정) */
  hasStamp: boolean | undefined;
  /** EIP-7702 코드가 우리 구현체를 가리키는지 */
  isDelegationAccount: boolean | undefined;
  /** 계정에 실제로 심긴 code (진단용) */
  code: Hex | undefined;
  /** tKRW 잔액 (최소단위) */
  tkrwBalance: bigint | undefined;
  /** 가스용 ETH */
  ethBalance: bigint | undefined;
  isLoading: boolean;
}

export function useAccountStatus(): AccountStatus {
  const { address } = useAccount();
  const client = usePublicClient();

  const stamp = useReadContract({
    address: ADDR.dojangGate,
    abi: ABI.dojangVerifiedGate,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const tkrw = useReadContract({
    address: ADDR.tKRW,
    abi: ABI.tKRW,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const eth = useBalance({ address, query: { enabled: Boolean(address) } });

  /**
   * 7702 게이팅 (설계서 v1.1) — `eth_getCode`가 `0xef0100 + 구현체주소` 여야
   * 위임 발급이 가능하다. 다른 구현체를 가리키는 경우도 걸러내야 하므로
   * 접두사만 보지 않고 전체를 비교한다.
   */
  const code = useQuery({
    queryKey: ["code", address],
    enabled: Boolean(address && client),
    queryFn: async () => {
      const c = await client!.getCode({ address: address as Address });
      return (c ?? "0x") as Hex;
    },
    refetchInterval: 10_000,
  });

  const expectedCode = `0xef0100${ADDR.delegator7702Impl.slice(2)}`.toLowerCase();

  return {
    hasStamp: stamp.data as boolean | undefined,
    isDelegationAccount:
      code.data === undefined ? undefined : code.data.toLowerCase() === expectedCode,
    code: code.data,
    tkrwBalance: tkrw.data as bigint | undefined,
    ethBalance: eth.data?.value,
    isLoading: stamp.isLoading || tkrw.isLoading || code.isLoading,
  };
}

/** 기대되는 7702 designator — 안내 카드에 그대로 보여준다 */
export function expectedDelegationCode(): string {
  return `0xef0100${ADDR.delegator7702Impl.slice(2)}`;
}
