import { encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";
import { ADDR } from "./addresses.js";
import type { Caveat, JipsaPolicy } from "./delegation.js";

/** `IERC20.transfer(address,uint256)` 셀렉터 */
export const TRANSFER_SELECTOR = "0xa9059cbb" as const satisfies Hex;

/** 기간 enforcer의 기간 길이 — 1일 */
export const PERIOD_DURATION_1D = 86_400n;

/**
 * `startDate` 기본값에 적용하는 안전 여유 (초).
 *
 * ⚠️ 기간 enforcer는 `require(block.timestamp >= startDate)`를 강제한다
 * (ERC20PeriodTransferEnforcer.sol:199 — `transfer-not-started`).
 * 서명하는 쪽의 벽시계가 체인 `block.timestamp`보다 조금이라도 앞서면 **첫 리딤이
 * 실패한다.** 포크 환경에서는 체인 시각이 수십 초 뒤처져 항상 실패한다 (실측 36초).
 *
 * 기간 길이가 1일이므로 몇 분 과거로 당겨도 일간 한도 의미는 달라지지 않는다.
 * 정확한 값이 필요하면 `startDateFromChain()`으로 체인 시각을 직접 읽어 넘길 것.
 */
export const PERIOD_START_SKEW_BUFFER = 300n;

/**
 * 체인의 최신 블록 시각을 `startDate`로 쓴다 — 가장 정확한 방법.
 * @param client `getBlock`을 제공하는 viem PublicClient
 */
export async function startDateFromChain(client: {
  getBlock: () => Promise<{ timestamp: bigint }>;
}): Promise<bigint> {
  return (await client.getBlock()).timestamp;
}

const EMPTY_ARGS = "0x" as const satisfies Hex;

// ---------------------------------------------------------------------------
// terms 인코딩 — 각 enforcer의 getTermsInfo() 소스를 열어 맞춘 것이다 (추측 금지).
// ---------------------------------------------------------------------------

/**
 * 출처: lib/delegation-framework/src/enforcers/AllowedTargetsEnforcer.sol `getTermsInfo`
 * `terms.length % 20 == 0`, 20바이트 주소를 이어 붙인다.
 */
export function allowedTargetsTerms(targets: readonly Address[]): Hex {
  return encodePacked(
    targets.map(() => "address"),
    [...targets],
  );
}

/**
 * 출처: lib/delegation-framework/src/enforcers/AllowedMethodsEnforcer.sol `getTermsInfo`
 * `terms.length % 4 == 0`, 4바이트 셀렉터를 이어 붙인다.
 */
export function allowedMethodsTerms(selectors: readonly Hex[]): Hex {
  return encodePacked(
    selectors.map(() => "bytes4"),
    [...selectors],
  );
}

/**
 * 출처: lib/delegation-framework/src/enforcers/TimestampEnforcer.sol `getTermsInfo`
 * `terms.length == 32` — `uint128 after || uint128 before`.
 * after=0 이면 하한 없음.
 */
export function timestampTerms(validUntil: number, validAfter = 0): Hex {
  return encodePacked(["uint128", "uint128"], [BigInt(validAfter), BigInt(validUntil)]);
}

/**
 * 출처: src/enforcers/JipsaPerTxCapEnforcer.sol `getTermsInfo`
 * `terms.length == 52` — `address token || uint256 cap`.
 */
export function perTxCapTerms(token: Address, cap: bigint): Hex {
  return encodePacked(["address", "uint256"], [token, cap]);
}

/**
 * 출처: lib/delegation-framework/src/enforcers/ERC20TransferAmountEnforcer.sol `getTermsInfo`
 * `terms.length == 52` — `address token || uint256 maxTokens`.
 */
export function totalBudgetTerms(token: Address, totalBudget: bigint): Hex {
  return encodePacked(["address", "uint256"], [token, totalBudget]);
}

/**
 * 출처: lib/delegation-framework/src/enforcers/ERC20PeriodTransferEnforcer.sol `getTermsInfo`
 * `terms.length == 116` — `address token || uint256 periodAmount || uint256 periodDuration || uint256 startDate`.
 */
export function periodTransferTerms(
  token: Address,
  periodAmount: bigint,
  startDate: bigint,
  periodDuration: bigint = PERIOD_DURATION_1D,
): Hex {
  return encodePacked(
    ["address", "uint256", "uint256", "uint256"],
    [token, periodAmount, periodDuration, startDate],
  );
}

/**
 * 출처: src/enforcers/DojangCaveatEnforcer.sol `getTermsInfo`
 * `terms.length == 128` — `abi.encode(gate, registry, token, verifiedRecipientOnly)`.
 * ⚠️ 다른 enforcer들과 달리 packed가 아니라 **abi.encode**다.
 */
export function dojangTerms(
  gate: Address,
  registry: Address,
  token: Address,
  verifiedRecipientOnly: boolean,
): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bool" }],
    [gate, registry, token, verifiedRecipientOnly],
  );
}

// ---------------------------------------------------------------------------
// 조합
// ---------------------------------------------------------------------------

/**
 * JIPSA 표준 caveat 7종을 **확정된 순서로** 만든다.
 *
 * ① AllowedTargets ② AllowedMethods ③ Timestamp
 * ④ **JipsaPerTxCap** ⑤ ERC20TransferAmount ⑥ ERC20PeriodTransfer ⑦ Dojang
 *
 * ⚠️ **순서를 바꾸지 말 것.** caveat은 배열 순서대로 실행되므로 차단 사유가 순서에
 *    의존한다. 건당 상한을 금액 검사 앞에 두어야 과다 청구가 `PerTxCapExceeded`로
 *    걸린다 (뒤에 두면 기간 상한이 먼저 걸려 데모 대본과 어긋난다 — 실측 확인).
 *    Dojang은 외부 컨트랙트(gate·registry) 조회라 가장 비싸므로 맨 뒤.
 *    회귀 테스트: test/erc7710/DemoScenario.t.sol
 *
 * ⚠️ **누적 상한(⑤)을 빼지 말 것.** JipsaPerTxCap은 실행 1건당 금액만 보는 무상태
 *    enforcer라, 건당 상한만 넣으면 상한 이하 리딤을 반복해 잔액 전체가 빠진다.
 *    회귀 테스트: test/erc7710/CumulativeDrain.t.sol
 *
 * @param startDate 기간 enforcer의 기준 시각(unix 초).
 *        생략하면 로컬 시각에서 `PERIOD_START_SKEW_BUFFER`만큼 뺀 값을 쓴다 —
 *        체인 시각보다 앞서면 첫 리딤이 `transfer-not-started`로 실패하기 때문이다.
 *        가능하면 `startDateFromChain(client)`로 체인 시각을 넘길 것.
 */
export function buildCaveats(policy: JipsaPolicy, startDate?: bigint): Caveat[] {
  const start =
    startDate ?? BigInt(Math.floor(Date.now() / 1000)) - PERIOD_START_SKEW_BUFFER;

  return [
    { enforcer: ADDR.allowedTargetsEnforcer, terms: allowedTargetsTerms([ADDR.tKRW]), args: EMPTY_ARGS },
    { enforcer: ADDR.allowedMethodsEnforcer, terms: allowedMethodsTerms([TRANSFER_SELECTOR]), args: EMPTY_ARGS },
    { enforcer: ADDR.timestampEnforcer, terms: timestampTerms(policy.validUntil), args: EMPTY_ARGS },
    { enforcer: ADDR.perTxCapEnforcer, terms: perTxCapTerms(ADDR.tKRW, policy.perTxCap), args: EMPTY_ARGS },
    {
      enforcer: ADDR.erc20TransferAmountEnforcer,
      terms: totalBudgetTerms(ADDR.tKRW, policy.totalBudget),
      args: EMPTY_ARGS,
    },
    {
      enforcer: ADDR.periodTransferEnforcer,
      terms: periodTransferTerms(ADDR.tKRW, policy.dailyCap, start),
      args: EMPTY_ARGS,
    },
    {
      enforcer: ADDR.dojangEnforcer,
      terms: dojangTerms(ADDR.dojangGate, ADDR.bindingRegistry, ADDR.tKRW, policy.verifiedRecipientOnly),
      args: EMPTY_ARGS,
    },
  ];
}
