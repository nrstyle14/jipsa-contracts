import { describe, expect, it } from "vitest";
import { ADDR, DEMO, tkrw } from "../src/addresses.js";
import { buildCaveats } from "../src/caveats.js";
import { ROOT_AUTHORITY, type Delegation, type JipsaPolicy } from "../src/delegation.js";
import { delegationFromJson, delegationToJson } from "../src/serialization.js";
import { decodeRevert, errorSelectors } from "../src/errors.js";

const policy: JipsaPolicy = {
  totalBudget: tkrw(5_000),
  perTxCap: tkrw(50),
  dailyCap: tkrw(500),
  validUntil: 1_800_000_000,
  verifiedRecipientOnly: true,
  agent: DEMO.agent,
};

const delegation: Delegation = {
  delegate: DEMO.agent,
  delegator: DEMO.owner,
  authority: ROOT_AUTHORITY,
  caveats: buildCaveats(policy, 1_790_000_000n),
  salt: 12345678901234567890n,
  signature: `0x${"ab".repeat(65)}`,
};

describe("delegation.json 직렬화", () => {
  it("왕복해도 값이 보존된다 (salt bigint 포함)", () => {
    const json = delegationToJson(delegation);
    const back = delegationFromJson(JSON.parse(JSON.stringify(json)));
    expect(back).toEqual(delegation);
    expect(back.salt).toBe(delegation.salt);
  });

  it("salt를 문자열로 담는다 (JSON에 bigint 불가)", () => {
    expect(delegationToJson(delegation).salt).toBe("12345678901234567890");
  });

  it("version이 다르면 거부한다", () => {
    const json = { ...delegationToJson(delegation), version: 2 };
    expect(() => delegationFromJson(json)).toThrow(/version/);
  });

  it("주소·hex 형식을 검증한다", () => {
    const bad = { ...delegationToJson(delegation), delegator: "not-an-address" };
    expect(() => delegationFromJson(bad)).toThrow(/delegator/);
  });

  it("caveats가 비면 거부한다", () => {
    const bad = { ...delegationToJson(delegation), caveats: [] };
    expect(() => delegationFromJson(bad)).toThrow(/caveats/);
  });
});

describe("revert 사유 디코딩", () => {
  const sel = errorSelectors();

  it("셀렉터를 ABI에서 계산한다 (손으로 적지 않는다)", () => {
    // cast sig "PerTxCapExceeded(uint256,uint256)" == 0xc154b3a8
    expect(sel.PerTxCapExceeded).toBe("0xc154b3a8");
    // cast sig "RecipientNotVerified(address)" == 0xa3e9d91e
    expect(sel.RecipientNotVerified).toBe("0xa3e9d91e");
  });

  it("커스텀 에러를 이름·인자·설명으로 푼다", () => {
    const data = `${sel.PerTxCapExceeded}${(50_000_001n).toString(16).padStart(64, "0")}${(50_000_000n).toString(16).padStart(64, "0")}` as `0x${string}`;
    const d = decodeRevert(data);
    expect(d?.reason).toBe("PerTxCapExceeded");
    expect(d?.args).toEqual([50_000_001n, 50_000_000n]);
    expect(d?.label).toBe("건당 한도를 초과했습니다");
  });

  it("스톡 enforcer의 require 문자열을 푼다", () => {
    // Error("ERC20TransferAmountEnforcer:allowance-exceeded")
    const msg = "ERC20TransferAmountEnforcer:allowance-exceeded";
    const hex = Buffer.from(msg, "utf8").toString("hex");
    const data = `0x08c379a0${(32n).toString(16).padStart(64, "0")}${BigInt(msg.length).toString(16).padStart(64, "0")}${hex.padEnd(64, "0")}` as `0x${string}`;
    const d = decodeRevert(data);
    expect(d?.reason).toBe(msg);
    expect(d?.label).toBe("총예산을 초과했습니다");
  });

  it("빈 데이터는 undefined", () => {
    expect(decodeRevert(undefined)).toBeUndefined();
    expect(decodeRevert("0x")).toBeUndefined();
  });

  it("ERROR_ABI에 우리 enforcer 에러가 들어있다", () => {
    expect(Object.keys(sel)).toContain("RecipientNotVerified");
    expect(Object.keys(sel)).toContain("AgentNotBound");
    expect(Object.keys(sel)).toContain("CannotUseADisabledDelegation");
  });
});
