import {
  decodeErrorResult,
  toFunctionSelector,
  type Abi,
  type Hex,
} from "viem";
import { ABI } from "./abis.js";

/**
 * 우리 enforcer + DelegationManager의 커스텀 에러를 모은 ABI.
 *
 * `redeemDelegations` 호출은 DelegationManager를 거치지만 실제 revert는 enforcer에서
 * 나므로, DelegationManager ABI만으로는 디코딩되지 않는다. 에러 프래그먼트를 합쳐야
 * 사람이 읽을 수 있는 사유가 나온다.
 *
 * 대시보드 실시간 피드의 "차단됨" 행 사유 표시에 그대로 쓴다 (지시서 작업 3 M3).
 */
export const ERROR_ABI: Abi = [
  ...ABI.delegationManager.filter((f) => f.type === "error"),
  ...ABI.dojangCaveatEnforcer.filter((f) => f.type === "error"),
  ...ABI.jipsaPerTxCapEnforcer.filter((f) => f.type === "error"),
  ...ABI.erc20TransferAmountEnforcer.filter((f) => f.type === "error"),
  ...ABI.erc20PeriodTransferEnforcer.filter((f) => f.type === "error"),
];

/**
 * 스톡 enforcer는 커스텀 에러가 아니라 `require` 문자열을 쓴다.
 * `Error(string)`으로 인코딩되므로 별도로 처리한다.
 */
const ERROR_STRING_SELECTOR = "0x08c379a0";

export interface DecodedRevert {
  /** 커스텀 에러 이름 또는 require 문자열 */
  reason: string;
  /** 커스텀 에러 인자 (있으면) */
  args?: readonly unknown[];
  /** 원본 셀렉터 — 매핑에 없는 에러를 조사할 때 쓴다 */
  selector?: Hex;
  /** 사람에게 보여줄 한 줄 설명 */
  label: string;
}

/**
 * revert 데이터를 사람이 읽을 수 있는 사유로 바꾼다.
 *
 * @param data `eth_call` 실패 시의 revert data (0x…)
 */
export function decodeRevert(data: Hex | undefined): DecodedRevert | undefined {
  if (!data || data === "0x" || data.length < 10) return undefined;
  const selector = data.slice(0, 10) as Hex;

  if (selector === ERROR_STRING_SELECTOR) {
    try {
      const decoded = decodeErrorResult({
        abi: [
          {
            type: "error",
            name: "Error",
            inputs: [{ name: "message", type: "string" }],
          },
        ],
        data,
      });
      const message = String(decoded.args?.[0] ?? "");
      return { reason: message, selector, label: KNOWN_REQUIRE[message] ?? message };
    } catch {
      return { reason: "알 수 없는 revert 문자열", selector, label: "알 수 없는 revert" };
    }
  }

  try {
    const decoded = decodeErrorResult({ abi: ERROR_ABI, data });
    const name = decoded.errorName;
    return {
      reason: name,
      args: decoded.args,
      selector,
      label: KNOWN_CUSTOM[name] ?? name,
    };
  } catch {
    return { reason: selector, selector, label: `알 수 없는 커스텀 에러 (${selector})` };
  }
}

/** 커스텀 에러 → 사람이 읽는 문장 */
const KNOWN_CUSTOM: Record<string, string> = {
  PerTxCapExceeded: "건당 한도를 초과했습니다",
  RecipientNotVerified: "수신처에 Dojang 도장이 없습니다",
  AgentNotBound: "에이전트가 이 주인에게 바인딩되어 있지 않습니다",
  OwnerNotVerified: "주인의 Dojang 도장이 유효하지 않습니다",
  CannotUseADisabledDelegation: "철회된 위임입니다",
  InvalidDelegate: "이 위임을 사용할 수 있는 주소가 아닙니다",
  InvalidERC1271Signature: "위임 서명이 유효하지 않습니다",
  InvalidEOASignature: "위임 서명이 유효하지 않습니다",
  InvalidContract: "허용되지 않은 토큰 컨트랙트입니다",
  InvalidMethod: "허용되지 않은 메서드입니다",
};

/** 스톡 enforcer의 require 문자열 → 사람이 읽는 문장 */
const KNOWN_REQUIRE: Record<string, string> = {
  "ERC20TransferAmountEnforcer:allowance-exceeded": "총예산을 초과했습니다",
  "ERC20PeriodTransferEnforcer:transfer-amount-exceeded": "기간 한도를 초과했습니다",
  "ERC20PeriodTransferEnforcer:transfer-not-started": "위임 시작 시각이 아직 지나지 않았습니다",
  "TimestampEnforcer:expired-delegation": "위임이 만료되었습니다",
  "TimestampEnforcer:early-delegation": "위임 시작 시각이 아직 지나지 않았습니다",
  "AllowedTargetsEnforcer:target-address-not-allowed": "허용되지 않은 수신 컨트랙트입니다",
  "AllowedMethodsEnforcer:method-not-allowed": "허용되지 않은 메서드입니다",
  "CaveatEnforcer:invalid-call-type": "실행 모드가 맞지 않습니다 (single/batch)",
};

/**
 * viem 에러 객체에서 revert 데이터를 뽑는다.
 *
 * ⚠️ 에러 메시지 문자열에는 revert 데이터가 담기지 않는다. 또한 viem 버전·경로에
 *    따라 `data`가 hex 문자열일 때도 있고 `{ data: hex }` 객체일 때도 있어 양쪽을
 *    모두 처리해야 한다. (한쪽만 처리했다가 사유를 못 뽑는 문제를 겪었다)
 */
export function extractRevertData(error: unknown): Hex | undefined {
  const seen = new Set<unknown>();
  const visit = (e: unknown): Hex | undefined => {
    if (!e || typeof e !== "object" || seen.has(e)) return undefined;
    seen.add(e);
    const raw = (e as { data?: unknown }).data;
    if (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) return raw as Hex;
    if (raw && typeof raw === "object") {
      const nested = (raw as { data?: unknown }).data;
      if (typeof nested === "string" && nested.startsWith("0x") && nested.length >= 10) {
        return nested as Hex;
      }
    }
    // cause 체인과 details 문자열 양쪽을 훑는다
    const fromCause = visit((e as { cause?: unknown }).cause);
    if (fromCause) return fromCause;
    const details = (e as { details?: unknown }).details;
    if (typeof details === "string") {
      const m = /0x[0-9a-fA-F]{8,}/.exec(details);
      if (m) return m[0] as Hex;
    }
    return undefined;
  };
  return visit(error);
}

/**
 * viem 에러에서 사람이 읽을 수 있는 revert 사유를 뽑는다.
 * 대시보드의 "차단됨" 행·토스트에 그대로 쓴다.
 */
export function decodeRevertFromError(error: unknown): DecodedRevert | undefined {
  return decodeRevert(extractRevertData(error));
}

/**
 * 알려진 에러의 셀렉터 표 — 디버깅·테스트에서 셀렉터를 추측하지 않게 한다.
 * 값은 ABI에서 계산하므로 손으로 적은 상수가 아니다.
 */
export function errorSelectors(): Record<string, Hex> {
  const out: Record<string, Hex> = {};
  for (const f of ERROR_ABI) {
    if (f.type !== "error") continue;
    const sig = `${f.name}(${f.inputs.map((i) => i.type).join(",")})`;
    out[f.name] = toFunctionSelector(sig);
  }
  return out;
}
