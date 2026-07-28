/**
 * `delegation.json`이 **실제로 리딤 가능한지** 검증한다 (브로드캐스트 없음).
 *
 * grant.ts가 파일을 만들어도 온체인에서 통과하는지는 별개다. 여기서 `eth_call`로
 * 리딤을 시뮬레이션해 caveat 전체를 실제 컨트랙트에 통과시킨다.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent verify
 *
 * 환경변수: RPC_URL(선택) · IN(선택, 기본 apps/agent/delegation.json)
 *           MERCHANT_A(선택, 기본 DEMO.merchantA) · ATTACKER(선택)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import {
  ABI,
  ADDR,
  decodeRevertFromError,
  CHAIN_ID,
  DEMO,
  FLASHBLOCKS_RPC_URL,
  delegationFromJson,
  delegationTypedData,
  encodeRedeem,
  getDelegationHash,
  tkrw,
  type Delegation,
} from "@jipsa/delegation";
import { optionalAddress, optionalString } from "../src/env.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = optionalString("IN")
  ? resolve(optionalString("IN")!)
  : resolve(appRoot, "delegation.json");
const rpcUrl = optionalString("RPC_URL") ?? FLASHBLOCKS_RPC_URL;
const merchant = optionalAddress("MERCHANT_A") ?? DEMO.merchantA;
/** 도장 없는 주소 — Dojang 차단 확인용 */
const attacker = optionalAddress("ATTACKER") ?? "0x000000000000000000000000000000000000dEaD";

const chain = {
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;

const client = createPublicClient({ chain, transport: http(rpcUrl) });

function redeemData(d: Delegation, to: Address, amount: bigint): Hex {
  const call = encodeRedeem(d, to, amount);
  return encodeFunctionData({
    abi: ABI.delegationManager,
    functionName: "redeemDelegations",
    args: [call.permissionContexts, call.modes, call.executionCallDatas],
  });
}

async function simulate(d: Delegation, to: Address, amount: bigint) {
  return client.call({
    account: d.delegate,
    to: ADDR.delegationManager,
    data: redeemData(d, to, amount),
  });
}

/**
 * revert 사유를 이름으로 뽑는다.
 *
 * ⚠️ 셀렉터를 손으로 적어 문자열 매칭하면 안 된다 (추측했다가 틀렸다).
 *    ERROR_ABI로 디코딩한다.
 */
function revertReason(e: unknown): string {
  return decodeRevertFromError(e)?.reason ?? `디코딩 실패: ${msg(e).slice(0, 60)}`;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const raw = JSON.parse(readFileSync(inPath, "utf8")) as unknown;
  const d = delegationFromJson(raw); // 형식 검증 포함

  console.log("위임 검증:", inPath);
  console.log("  RPC      :", rpcUrl);
  console.log("  delegator:", d.delegator);
  console.log("  delegate :", d.delegate);
  console.log("");

  // 1) 서명이 delegator 본인 것인지
  const recovered = await recoverTypedDataAddress({
    ...delegationTypedData({ ...d, signature: "0x" }),
    signature: d.signature,
  });
  check(
    "서명자 == delegator",
    recovered.toLowerCase() === d.delegator.toLowerCase(),
    recovered,
  );

  // 2) 철회되지 않았는지
  const hash = getDelegationHash(d);
  const disabled = await client.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "disabledDelegations",
    args: [hash],
  });
  check("철회되지 않음", disabled === false, hash);

  // 3) 도장 보유 가맹처로 정상 결제가 통과하는지 (caveat 7개 전부 통과)
  try {
    await simulate(d, merchant, tkrw(2));
    check("정상 결제 시뮬레이션 통과", true, `${merchant} 2 tKRW`);
  } catch (e) {
    check("정상 결제 시뮬레이션 통과", false, msg(e));
  }

  // 4) 건당 상한 초과가 우리 enforcer에서 막히는지
  try {
    await simulate(d, merchant, tkrw(51));
    check("건당 초과 차단", false, "통과되어 버렸다");
  } catch (e) {
    const reason = revertReason(e);
    check("건당 초과 차단", reason === "PerTxCapExceeded", reason);
  }

  // 5) 미검증 수신처가 Dojang에서 막히는지
  try {
    await simulate(d, attacker, tkrw(2));
    check("미검증 수신처 차단", false, "통과되어 버렸다");
  } catch (e) {
    const reason = revertReason(e);
    check("미검증 수신처 차단", reason === "RecipientNotVerified", reason);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures}건 실패 — 이 위임으로는 데모를 진행할 수 없습니다.`);
    process.exit(1);
  }
  console.log("전부 통과 — 리딤 가능한 위임입니다.");
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e: unknown) => {
  console.error("");
  console.error("실패:", msg(e));
  process.exit(1);
});
