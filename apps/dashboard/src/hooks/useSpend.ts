import { useReadContract } from "wagmi";
import {
  ABI,
  ADDR,
  getDelegationHash,
  perTxCapTerms,
  type Delegation,
} from "@jipsa/delegation";
import type { Hex } from "viem";

/** 정책 원본값 — 위임의 caveat terms에서 되짚는다 (온체인에 정책 레코드가 없다) */
export interface PolicyView {
  perTxCap: bigint;
  totalBudget: bigint;
  dailyCap: bigint;
  validUntil: number;
  verifiedRecipientOnly: boolean;
}

/**
 * caveat terms를 되짚어 정책 값을 복원한다.
 *
 * 7702 모델에는 `PolicyAccount.policy()` 같은 온체인 레코드가 없다. 정책은 주인이
 * 서명한 위임의 caveat terms 안에만 존재하므로, 화면 표시는 여기서 디코딩한다.
 * enforcer 주소로 어떤 caveat인지 판별한다 (순서에 의존하지 않는다).
 */
export function decodePolicy(d: Delegation | undefined): PolicyView | undefined {
  if (!d) return undefined;
  const byEnforcer = (addr: string) =>
    d.caveats.find((c) => c.enforcer.toLowerCase() === addr.toLowerCase());

  const perTx = byEnforcer(ADDR.perTxCapEnforcer);
  const total = byEnforcer(ADDR.erc20TransferAmountEnforcer);
  const period = byEnforcer(ADDR.periodTransferEnforcer);
  const ts = byEnforcer(ADDR.timestampEnforcer);
  const dojang = byEnforcer(ADDR.dojangEnforcer);
  if (!perTx || !total || !period || !ts || !dojang) return undefined;

  // packed 레이아웃은 각 enforcer의 getTermsInfo()와 동일하다 (packages/delegation/caveats.ts 참조)
  const u256At = (hex: Hex, byteOffset: number) =>
    BigInt(`0x${hex.slice(2).slice(byteOffset * 2, byteOffset * 2 + 64)}`);

  return {
    // address(20) || uint256
    perTxCap: u256At(perTx.terms, 20),
    totalBudget: u256At(total.terms, 20),
    // address(20) || periodAmount || periodDuration || startDate
    dailyCap: u256At(period.terms, 20),
    // uint128 after || uint128 before
    validUntil: Number(BigInt(`0x${ts.terms.slice(2).slice(32, 64)}`)),
    // abi.encode(...,bool) — 마지막 워드
    verifiedRecipientOnly: BigInt(`0x${dojang.terms.slice(-64)}`) === 1n,
  };
}

export interface SpendView {
  policy: PolicyView | undefined;
  /** 누적 지출 (ERC20TransferAmountEnforcer.spentMap) */
  spentTotal: bigint | undefined;
  /** 이번 기간 남은 가용액 (ERC20PeriodTransferEnforcer.getAvailableAmount) */
  availableToday: bigint | undefined;
  /** 철회 여부 */
  disabled: boolean | undefined;
  delegationHash: Hex | undefined;
}

/**
 * 지출 게이지 데이터 — enforcer 상태를 `delegationHash` 키로 조회한다.
 *
 * @dev `getAvailableAmount`는 enforcer가 아직 초기화되지 않은(리딤 0건) 상태에서도
 *      terms로 시뮬레이션해 값을 돌려준다 — 위임 발급 직후에도 게이지가 정확하다.
 */
export function useSpend(d: Delegation | undefined): SpendView {
  const policy = decodePolicy(d);
  const hash = d ? getDelegationHash(d) : undefined;

  const periodTerms = d?.caveats.find(
    (c) => c.enforcer.toLowerCase() === ADDR.periodTransferEnforcer.toLowerCase(),
  )?.terms;

  const spent = useReadContract({
    address: ADDR.erc20TransferAmountEnforcer,
    abi: ABI.erc20TransferAmountEnforcer,
    functionName: "spentMap",
    args: hash ? [ADDR.delegationManager, hash] : undefined,
    query: { enabled: Boolean(hash), refetchInterval: 3_000 },
  });

  const available = useReadContract({
    address: ADDR.periodTransferEnforcer,
    abi: ABI.erc20PeriodTransferEnforcer,
    functionName: "getAvailableAmount",
    args: hash && periodTerms ? [hash, ADDR.delegationManager, periodTerms] : undefined,
    query: { enabled: Boolean(hash && periodTerms), refetchInterval: 3_000 },
  });

  const disabled = useReadContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "disabledDelegations",
    args: hash ? [hash] : undefined,
    query: { enabled: Boolean(hash), refetchInterval: 3_000 },
  });

  const availableTuple = available.data as readonly [bigint, boolean, bigint] | undefined;

  return {
    policy,
    spentTotal: spent.data as bigint | undefined,
    availableToday: availableTuple?.[0],
    disabled: disabled.data as boolean | undefined,
    delegationHash: hash,
  };
}

/** 건당 상한 caveat의 terms — 표시용 */
export function perTxTermsFor(cap: bigint) {
  return perTxCapTerms(ADDR.tKRW, cap);
}
