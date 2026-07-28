import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { ADDR, CHAIN_ID } from "./addresses.js";

// ---------------------------------------------------------------------------
// 상수 — 전부 lib/delegation-framework v1.3.0 소스에서 읽은 값이다 (추측 금지).
// ---------------------------------------------------------------------------

/**
 * EIP-712 도메인 name.
 * 출처: lib/delegation-framework/src/DelegationManager.sol:29
 *   `string public constant NAME = "DelegationManager";`
 */
export const EIP712_DOMAIN_NAME = "DelegationManager" as const;

/**
 * EIP-712 도메인 version.
 * 출처: lib/delegation-framework/src/DelegationManager.sol:35
 *   `string public constant DOMAIN_VERSION = "1";`
 */
export const EIP712_DOMAIN_VERSION = "1" as const;

/**
 * 루트 위임의 authority.
 * 출처: lib/delegation-framework/src/DelegationManager.sol:38
 *   `bytes32 public constant ROOT_AUTHORITY = 0xffff…ffff;`
 */
export const ROOT_AUTHORITY =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const satisfies Hex;

/**
 * `ModeLib.encodeSimpleSingle()` — single call type + default exec type.
 *
 * 출처: lib/delegation-framework/lib/erc7579-implementation/src/lib/ModeLib.sol
 *   - `encodeSimpleSingle()`(:128) = `encode(CALLTYPE_SINGLE, EXECTYPE_DEFAULT, MODE_DEFAULT, 0)`
 *   - `encode()`(:107) = `abi.encodePacked(callType(1), execType(1), bytes4(0), modeSelector(4), payload(22))`
 *   - `CALLTYPE_SINGLE = 0x00`(:66) · `EXECTYPE_DEFAULT = 0x00`(:77) · `MODE_DEFAULT = 0x00000000`(:81)
 * → 모든 필드가 0이므로 결과는 bytes32(0).
 *
 * ⚠️ 우리 caveat은 Timestamp를 제외하면 전부 `onlySingleCallTypeMode`다.
 *    batch 모드(`CALLTYPE_BATCH = 0x01`)로 보내면 전부 revert한다.
 */
export const MODE_SIMPLE_SINGLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const satisfies Hex;

/**
 * EIP-712 타입 정의.
 *
 * 출처: lib/delegation-framework/src/utils/Constants.sol:11-16
 *   - `DELEGATION_TYPEHASH`에서 **signature가 제외**된다 (소스 주석에 명시)
 *   - `CAVEAT_TYPEHASH`에서 **args가 제외**된다
 * 서명 대상 구조체에 signature·args를 넣으면 해시가 달라져 검증에 실패한다.
 */
export const DELEGATION_TYPES = {
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** 출처: lib/delegation-framework/src/utils/Types.sol `struct Caveat` */
export interface Caveat {
  enforcer: Address;
  terms: Hex;
  /** 리딤 시점에 리디머가 넣는 값. **서명 대상에서 제외된다.** */
  args: Hex;
}

/** 출처: lib/delegation-framework/src/utils/Types.sol `struct Delegation` */
export interface Delegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}

/** JIPSA 정책 — 금액 단위는 tKRW 최소단위(6 decimals) */
export interface JipsaPolicy {
  totalBudget: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  /** unix 초 */
  validUntil: number;
  verifiedRecipientOnly: boolean;
  /** delegate — 위임받는 에이전트 EOA */
  agent: Address;
}

// ---------------------------------------------------------------------------
// EIP-712
// ---------------------------------------------------------------------------

/** `DelegationManager`의 EIP-712 도메인 */
export function delegationDomain(
  delegationManager: Address = ADDR.delegationManager,
  chainId: number = CHAIN_ID,
): TypedDataDomain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: delegationManager,
  };
}

/** 서명 대상 메시지 (signature·args 제외) */
export function delegationMessage(d: Delegation) {
  return {
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
    salt: d.salt,
  };
}

/**
 * `signTypedData`에 그대로 넘길 수 있는 파라미터를 만든다.
 * 지갑(MetaMask)과 로컬 계정(viem privateKeyToAccount) 양쪽에서 동일하게 쓴다.
 */
export function delegationTypedData(d: Delegation, delegationManager?: Address, chainId?: number) {
  return {
    domain: delegationDomain(delegationManager, chainId),
    types: DELEGATION_TYPES,
    primaryType: "Delegation" as const,
    message: delegationMessage(d),
  };
}

/**
 * 위임 해시 — enforcer 상태 조회(`spentMap`·`periodicAllowances`)와
 * `disabledDelegations` 조회의 키다.
 *
 * 출처: lib/delegation-framework/src/libraries/EncoderLib.sol `_getDelegationHash`
 * ⚠️ EIP-712 typed data 해시가 아니라 **구조체 해시**다. 도메인이 섞이지 않는다.
 */
export function getDelegationHash(d: Delegation): Hex {
  // EncoderLib._getCaveatPacketHash(:50) — abi.encode(typehash, enforcer, keccak256(terms))
  const caveatHashes = d.caveats.map((c) =>
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
        [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)],
      ),
    ),
  );
  // EncoderLib._getCaveatArrayPacketHash(:41) — keccak256(abi.encodePacked(bytes32[]))
  // ⚠️ abi.encode가 아니다. packed는 offset·length 접두가 없어 32바이트 워드를 그냥 이어 붙인다.
  const packedCaveats = keccak256(concatHex(caveatHashes));
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [DELEGATION_TYPEHASH, d.delegate, d.delegator, d.authority, packedCaveats, d.salt],
    ),
  );
}

/** 출처: lib/delegation-framework/src/utils/Constants.sol:12-14 */
export const DELEGATION_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)",
  ),
);

/** 출처: lib/delegation-framework/src/utils/Constants.sol:16 */
export const CAVEAT_TYPEHASH = keccak256(
  new TextEncoder().encode("Caveat(address enforcer,bytes terms)"),
);
