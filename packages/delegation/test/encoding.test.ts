import { describe, expect, it } from "vitest";
import { ADDR, DEMO, tkrw } from "../src/addresses.js";
import {
  buildCaveats,
  allowedMethodsTerms,
  allowedTargetsTerms,
  dojangTerms,
  periodTransferTerms,
  perTxCapTerms,
  timestampTerms,
  totalBudgetTerms,
  TRANSFER_SELECTOR,
} from "../src/caveats.js";
import {
  getDelegationHash,
  MODE_SIMPLE_SINGLE,
  ROOT_AUTHORITY,
  type Delegation,
  type JipsaPolicy,
} from "../src/delegation.js";
import { encodeRedeem, encodeTokenTransferExecution } from "../src/redeem.js";

/**
 * 기대값은 **Solidity에서 뽑은 것**이다 — 자기충족적 스냅샷이 아니다.
 *
 * 재생성:
 *   forge script script/PrintCaveats.s.sol
 *
 * 입력 상수는 script/PrintCaveats.s.sol 과 동일해야 한다.
 * 인코딩이 어긋나면 이 테스트가 깨진다.
 */
const VALID_UNTIL = 1_800_000_000;
const START_DATE = 1_790_000_000n;
const SALT = 7n;
const PAY_AMOUNT = tkrw(2);

const POLICY: JipsaPolicy = {
  totalBudget: tkrw(5_000),
  perTxCap: tkrw(50),
  dailyCap: tkrw(500),
  validUntil: VALID_UNTIL,
  verifiedRecipientOnly: true,
  agent: DEMO.agent,
};

// forge script script/PrintCaveats.s.sol 출력
const SOLIDITY = {
  allowedTargets: "0x1e743c166faeeee5b840a471a6760535ae4076b0",
  allowedMethods: "0xa9059cbb",
  timestamp: "0x000000000000000000000000000000000000000000000000000000006b49d200",
  perTxCap:
    "0x1e743c166faeeee5b840a471a6760535ae4076b00000000000000000000000000000000000000000000000000000000002faf080",
  totalBudget:
    "0x1e743c166faeeee5b840a471a6760535ae4076b0000000000000000000000000000000000000000000000000000000012a05f200",
  periodTransfer:
    "0x1e743c166faeeee5b840a471a6760535ae4076b0000000000000000000000000000000000000000000000000000000001dcd65000000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000006ab13b80",
  dojang:
    "0x000000000000000000000000d13ae574e53f2d14f71411383cceec9c16529fc30000000000000000000000006ef7f805fbcaa49cbfc11c861e2ec051549433c70000000000000000000000001e743c166faeeee5b840a471a6760535ae4076b00000000000000000000000000000000000000000000000000000000000000001",
  modeSimpleSingle: "0x0000000000000000000000000000000000000000000000000000000000000000",
  execution:
    "0x1e743c166faeeee5b840a471a6760535ae4076b00000000000000000000000000000000000000000000000000000000000000000a9059cbb00000000000000000000000049af607820b112aa35097d0eb9b8afe2235c181f00000000000000000000000000000000000000000000000000000000001e8480",
  delegationHash: "0xd4636e95c96201c0d6fdbb664c3133e04bb7ca541efd67b6b4af36555471da18",
} as const;

const lower = (h: string) => h.toLowerCase();

describe("terms 인코딩 — Solidity getTermsInfo 기준 교차 검증", () => {
  it("AllowedTargets (packed address)", () => {
    expect(lower(allowedTargetsTerms([ADDR.tKRW]))).toBe(SOLIDITY.allowedTargets);
  });

  it("AllowedMethods (packed bytes4)", () => {
    expect(lower(allowedMethodsTerms([TRANSFER_SELECTOR]))).toBe(SOLIDITY.allowedMethods);
    // transfer(address,uint256) 셀렉터
    expect(TRANSFER_SELECTOR).toBe("0xa9059cbb");
  });

  it("Timestamp (uint128 after || uint128 before, 32 bytes)", () => {
    const terms = timestampTerms(VALID_UNTIL);
    expect(lower(terms)).toBe(SOLIDITY.timestamp);
    expect((terms.length - 2) / 2).toBe(32);
  });

  it("JipsaPerTxCap (address || uint256, 52 bytes)", () => {
    const terms = perTxCapTerms(ADDR.tKRW, POLICY.perTxCap);
    expect(lower(terms)).toBe(SOLIDITY.perTxCap);
    expect((terms.length - 2) / 2).toBe(52);
  });

  it("ERC20TransferAmount (address || uint256, 52 bytes)", () => {
    const terms = totalBudgetTerms(ADDR.tKRW, POLICY.totalBudget);
    expect(lower(terms)).toBe(SOLIDITY.totalBudget);
    expect((terms.length - 2) / 2).toBe(52);
  });

  it("ERC20PeriodTransfer (address || amount || duration || start, 116 bytes)", () => {
    const terms = periodTransferTerms(ADDR.tKRW, POLICY.dailyCap, START_DATE);
    expect(lower(terms)).toBe(SOLIDITY.periodTransfer);
    expect((terms.length - 2) / 2).toBe(116);
  });

  it("Dojang (abi.encode, 128 bytes — packed 아님)", () => {
    const terms = dojangTerms(ADDR.dojangGate, ADDR.bindingRegistry, ADDR.tKRW, true);
    expect(lower(terms)).toBe(SOLIDITY.dojang);
    expect((terms.length - 2) / 2).toBe(128);
  });
});

describe("buildCaveats", () => {
  const caveats = buildCaveats(POLICY, START_DATE);

  it("확정된 순서를 지킨다 (차단 사유가 순서에 의존)", () => {
    expect(caveats.map((c) => c.enforcer)).toEqual([
      ADDR.allowedTargetsEnforcer,
      ADDR.allowedMethodsEnforcer,
      ADDR.timestampEnforcer,
      ADDR.perTxCapEnforcer, // 금액 검사 중 가장 앞 — PerTxCapExceeded가 먼저 나와야 한다
      ADDR.erc20TransferAmountEnforcer,
      ADDR.periodTransferEnforcer,
      ADDR.dojangEnforcer, // 외부 조회라 맨 뒤
    ]);
  });

  it("누적 상한이 반드시 포함된다 (드레인 방어)", () => {
    expect(caveats.some((c) => c.enforcer === ADDR.erc20TransferAmountEnforcer)).toBe(true);
  });

  it("건당 상한이 누적·기간 상한보다 앞에 있다", () => {
    const idx = (a: string) => caveats.findIndex((c) => c.enforcer === a);
    expect(idx(ADDR.perTxCapEnforcer)).toBeLessThan(idx(ADDR.erc20TransferAmountEnforcer));
    expect(idx(ADDR.perTxCapEnforcer)).toBeLessThan(idx(ADDR.periodTransferEnforcer));
  });

  it("args는 전부 비어 있다 (서명 대상에서 제외되는 필드)", () => {
    expect(caveats.every((c) => c.args === "0x")).toBe(true);
  });

  it("각 terms가 Solidity 기대값과 일치한다", () => {
    expect(lower(caveats[0]!.terms)).toBe(SOLIDITY.allowedTargets);
    expect(lower(caveats[1]!.terms)).toBe(SOLIDITY.allowedMethods);
    expect(lower(caveats[2]!.terms)).toBe(SOLIDITY.timestamp);
    expect(lower(caveats[3]!.terms)).toBe(SOLIDITY.perTxCap);
    expect(lower(caveats[4]!.terms)).toBe(SOLIDITY.totalBudget);
    expect(lower(caveats[5]!.terms)).toBe(SOLIDITY.periodTransfer);
    expect(lower(caveats[6]!.terms)).toBe(SOLIDITY.dojang);
  });
});

describe("모드·실행·해시", () => {
  const delegation: Delegation = {
    delegate: DEMO.agent,
    delegator: DEMO.owner,
    authority: ROOT_AUTHORITY,
    caveats: buildCaveats(POLICY, START_DATE),
    salt: SALT,
    signature: "0x",
  };

  it("MODE_SIMPLE_SINGLE = bytes32(0)", () => {
    expect(MODE_SIMPLE_SINGLE).toBe(SOLIDITY.modeSimpleSingle);
  });

  it("실행 인코딩이 ExecutionLib.encodeSingle과 같다", () => {
    expect(lower(encodeTokenTransferExecution(DEMO.merchantA, PAY_AMOUNT))).toBe(SOLIDITY.execution);
  });

  it("위임 해시가 EncoderLib._getDelegationHash와 같다", () => {
    expect(lower(getDelegationHash(delegation))).toBe(SOLIDITY.delegationHash);
  });

  it("encodeRedeem이 세 배열을 길이 1로 맞춰 만든다", () => {
    const call = encodeRedeem(delegation, DEMO.merchantA, PAY_AMOUNT);
    expect(call.permissionContexts).toHaveLength(1);
    expect(call.modes).toEqual([MODE_SIMPLE_SINGLE]);
    expect(lower(call.executionCallDatas[0]!)).toBe(SOLIDITY.execution);
  });
});
