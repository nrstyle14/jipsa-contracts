import { isAddress, isHex, type Address, type Hex } from "viem";
import type { Caveat, Delegation } from "./delegation.js";

/**
 * `delegation.json` 포맷.
 *
 * 대시보드가 내려주고 에이전트가 읽으므로 양쪽이 같은 포맷을 써야 한다.
 * `salt`는 bigint라 JSON에 직접 담을 수 없어 **10진 문자열**로 둔다.
 */
export interface DelegationJson {
  /** 포맷 버전 — 필드가 바뀌면 올린다 */
  version: 1;
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: { enforcer: Address; terms: Hex; args: Hex }[];
  /** 10진 문자열 (bigint) */
  salt: string;
  signature: Hex;
  /** 참고용 메타데이터 — 검증에는 쓰지 않는다 */
  meta?: {
    chainId: number;
    delegationManager: Address;
    /** EncoderLib._getDelegationHash 결과. enforcer 상태·철회 조회 키 */
    delegationHash: Hex;
    /** 사람이 읽기 위한 정책 요약 (tKRW 최소단위) */
    policy?: {
      totalBudget: string;
      perTxCap: string;
      dailyCap: string;
      validUntil: number;
      verifiedRecipientOnly: boolean;
    };
    createdAt?: string;
  };
}

export function delegationToJson(
  d: Delegation,
  meta?: DelegationJson["meta"],
): DelegationJson {
  return {
    version: 1,
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args })),
    salt: d.salt.toString(),
    signature: d.signature,
    ...(meta ? { meta } : {}),
  };
}

/**
 * `delegation.json`을 파싱한다.
 *
 * 에이전트가 파일에서 읽는 경로이므로 **형식을 검증한다** — 잘못된 파일로
 * 리딤을 시도하면 온체인에서 애매한 revert가 나 원인 파악이 어려워진다.
 */
export function delegationFromJson(input: unknown): Delegation {
  const j = input as Partial<DelegationJson>;

  if (j?.version !== 1) {
    throw new Error(`delegation.json: 지원하지 않는 version (${String(j?.version)}), 1이어야 함`);
  }
  requireAddress(j.delegate, "delegate");
  requireAddress(j.delegator, "delegator");
  requireHex(j.authority, "authority");
  requireHex(j.signature, "signature");
  if (typeof j.salt !== "string" || !/^\d+$/.test(j.salt)) {
    throw new Error("delegation.json: salt는 10진 문자열이어야 함");
  }
  if (!Array.isArray(j.caveats) || j.caveats.length === 0) {
    throw new Error("delegation.json: caveats가 비어 있음");
  }

  const caveats: Caveat[] = j.caveats.map((c, i) => {
    requireAddress(c?.enforcer, `caveats[${i}].enforcer`);
    requireHex(c?.terms, `caveats[${i}].terms`);
    requireHex(c?.args, `caveats[${i}].args`);
    return { enforcer: c.enforcer, terms: c.terms, args: c.args };
  });

  return {
    delegate: j.delegate,
    delegator: j.delegator,
    authority: j.authority,
    caveats,
    salt: BigInt(j.salt),
    signature: j.signature,
  };
}

function requireAddress(v: unknown, field: string): asserts v is Address {
  if (typeof v !== "string" || !isAddress(v)) {
    throw new Error(`delegation.json: ${field}가 주소 형식이 아님`);
  }
}

function requireHex(v: unknown, field: string): asserts v is Hex {
  if (typeof v !== "string" || !isHex(v)) {
    throw new Error(`delegation.json: ${field}가 hex 형식이 아님`);
  }
}
