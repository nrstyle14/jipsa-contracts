/**
 * E2E 체크 — **이 스크립트 통과가 영상 촬영 가능 판정 기준**이다 (지시서 v1.1 추가 C).
 *
 * 순서: verify(시뮬레이션) → pay 3건(실브로드캐스트) → trigger-block 2종 → 철회는 수동 안내
 * 각 단계를 체크리스트로 출력하고, 하나라도 실패하면 exit 1.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent e2e
 *
 * 옵션 (환경변수):
 *   AGENT_PRIVATE_KEY  필수 — 결제·차단 유발 실행
 *   MERCHANT_A         선택 — 기본 DEMO.merchantA
 *   IN                 선택 — 위임 파일 (기본 apps/agent/delegation.json)
 *
 * ⚠️ **철회는 자동으로 하지 않는다.** 대본(Act 4)에서 철회는 주인이 대시보드에서
 *    직접 누르는 장면이고, 자동 철회는 데모 위임을 비활성 상태로 남겨 리허설을 망친다.
 *    마지막에 수동 단계 안내만 출력한다.
 *
 * ⚠️ **연속 실행은 공개 RPC 한도에 걸린다.** 한 번에 온체인 호출이 40건 이상이고
 *    Dojang 검증처럼 무거운 `eth_call`이 섞여 있다. 실측에서 쉬지 않고 3회 돌리면
 *    2회차부터 `over rate limit`으로 실패했고 회복에 1~2분이 걸렸다 —
 *    실행 사이에 1~2분을 두거나 전용 RPC(`RPC_URL`)를 쓸 것.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, parseAbiItem, type Address, type Hex } from "viem";
import {
  ABI,
  ADDR,
  DEMO,
  TKRW_DECIMALS,
  delegationFromJson,
  getDelegationHash,
  tkrw,
} from "@jipsa/delegation";
import { giwaPublicClient } from "../src/clients.js";
import { optionalAddress, optionalString } from "../src/env.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = resolve(APP_ROOT, "node_modules/.bin/tsx");
const IN = optionalString("IN") ? resolve(optionalString("IN")!) : resolve(APP_ROOT, "delegation.json");

const client = giwaPublicClient();
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const fmt = (v: bigint) => `${formatUnits(v, TKRW_DECIMALS)} tKRW`;

/** pay 단계에서 낼 금액·건수 — 대본의 "2 tKRW × 3건" */
const PAY_AMOUNT_TKRW = 2;
const PAY_COUNT = 3;

// ---------------------------------------------------------------------------
// 체크리스트
// ---------------------------------------------------------------------------

interface Check {
  step: string;
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];

function check(step: string, name: string, passed: boolean, detail: string): void {
  checks.push({ step, name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name} — ${detail}`);
}

function stage(s: string): void {
  console.log(`\n${"─".repeat(72)}\n${s}\n`);
}

/**
 * 자식 프로세스로 실제 CLI를 돌린다.
 *
 * 함수를 직접 부르면 CLI 파싱·중단 경로가 검증되지 않는다 — 데모에서 사람이 치는
 * 명령과 같은 것을 돌려야 의미가 있다.
 */
function run(script: string, args: readonly string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(TSX, [resolve(APP_ROOT, script), ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(
    `${out
      .trimEnd()
      .split("\n")
      .map((l) => `    │ ${l}`)
      .join("\n")}\n`,
  );
  return { code: r.status ?? -1, out };
}

/**
 * 로그에서 tx 해시를 뽑는다.
 *
 * ⚠️ `0x`+64hex 를 통째로 긁으면 **헤더의 위임 해시까지 잡힌다** (실제로 3건 결제가
 *    4건으로 세어졌다). 그래서 각 스크립트의 성공 줄 형식에 맞춰 좁게 뽑는다.
 */
const paidHashes = (out: string): Hex[] =>
  [...out.matchAll(/✓\s+\d+\/\d+\s+(0x[0-9a-fA-F]{64})/g)].map((m) => m[1] as Hex);

/** trigger-block은 `tx      : 0x…` 로 찍는다 */
const triggeredHash = (out: string): Hex | undefined =>
  /tx\s*:\s*(0x[0-9a-fA-F]{64})/.exec(out)?.[1] as Hex | undefined;

// ---------------------------------------------------------------------------
// ① verify — 시뮬레이션
// ---------------------------------------------------------------------------

async function step1() {
  stage("① verify — 위임 전제 시뮬레이션 (온체인 상태 변경 없음)");

  if (!existsSync(IN)) {
    throw new Error(
      `위임 파일이 없습니다: ${IN}\n` +
        `  먼저 발급하세요: pnpm -F @jipsa/agent grant  (또는 대시보드 마법사)`,
    );
  }

  const { code, out } = run("scripts/verify-delegation.ts");
  check("①", "verify 종료 코드 0", code === 0, `code=${code}`);
  // verify-delegation은 각 항목을 "OK  " / "FAIL" 로 찍고 실패 시 exit 1 한다.
  // 마커를 잘못 잡으면 절대 실패하지 않는 가짜 검사가 되므로 실제 출력에 맞춘다.
  check("①", "전제 검사 FAIL 없음", !out.includes("FAIL"), "수임자·바인딩·도장·caveat");
  check(
    "①",
    "리딤 시뮬레이션 통과 문구 확인",
    out.includes("전부 통과"),
    "정상 결제 통과 + 차단 2종 확인",
  );

  const d = delegationFromJson(JSON.parse(readFileSync(IN, "utf8")) as unknown);
  const localHash = getDelegationHash(d);
  const onChainHash = (await client.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "getDelegationHash",
    args: [d],
  })) as Hex;
  check("①", "위임 해시 TS = 컨트랙트", localHash === onChainHash, localHash);
  check("①", "caveat 7종", d.caveats.length === 7, `${d.caveats.length}개`);

  const disabled = (await client.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "disabledDelegations",
    args: [localHash],
  })) as boolean;
  check("①", "위임이 살아 있음 (철회 전)", !disabled, disabled ? "철회됨 — 진행 불가" : "활성");
  if (disabled) {
    throw new Error(
      "이 위임은 철회되어 있습니다. 되살리려면: pnpm -F @jipsa/agent agent -- --enable",
    );
  }

  return { d, hash: localHash, owner: d.delegator as Address };
}

// ---------------------------------------------------------------------------
// ② pay — 실브로드캐스트 3건
// ---------------------------------------------------------------------------

async function step2(owner: Address, merchantA: Address) {
  stage(`② pay — ${PAY_AMOUNT_TKRW} tKRW × ${PAY_COUNT}건 실브로드캐스트`);

  const { code, out } = run("scripts/pay.ts", [
    "--amount",
    String(PAY_AMOUNT_TKRW),
    "--count",
    String(PAY_COUNT),
    "--interval",
    "1500",
  ]);
  check("②", "pay 종료 코드 0", code === 0, `code=${code}`);

  const hashes = [...new Set(paidHashes(out))];
  check("②", `결제 ${PAY_COUNT}건`, hashes.length === PAY_COUNT, `${hashes.length}건`);

  let allOk = hashes.length === PAY_COUNT;
  let lastBlock = 0n;
  for (const h of hashes) {
    const receipt = await client.waitForTransactionReceipt({ hash: h, timeout: 30_000 });
    const moved = receipt.logs.some(
      (l) =>
        l.address.toLowerCase() === ADDR.tKRW.toLowerCase() &&
        l.topics[1]?.toLowerCase().endsWith(owner.slice(2).toLowerCase()) &&
        l.topics[2]?.toLowerCase().endsWith(merchantA.slice(2).toLowerCase()),
    );
    if (receipt.status !== "success" || !moved) allOk = false;
    if (receipt.blockNumber > lastBlock) lastBlock = receipt.blockNumber;
  }
  check("②", "전건 성공 + 가맹처로 Transfer", allOk, `마지막 block ${lastBlock}`);

  // 대시보드 피드가 쓰는 것과 **같은 쿼리**로 보이는지 확인한다.
  // ⚠️ 게이트는 "보이는가"(결정적)로 두고 지연은 측정치로만 보고한다 — 인덱싱 지연이
  //    RPC 부하에 따라 20ms~1.7초로 흔들려 임계값으로 걸면 게이트가 간헐 실패한다.
  const probe = await feedVisibility(owner, lastBlock);
  check("②", "대시보드 피드 쿼리로 조회됨", probe.found, `getLogs 폴링 ${probe.polls}회`);
  console.log(`    ↳ 확정 → 로그 조회 지연 ${probe.ms}ms (참고값. 피드는 폴링 주기 1초가 더해진다)`);

  return { spent: tkrw(PAY_AMOUNT_TKRW) * BigInt(PAY_COUNT) };
}

async function feedVisibility(owner: Address, blockNumber: bigint) {
  const t0 = performance.now();
  for (let polls = 1; polls <= 100; polls++) {
    const logs = await client.getLogs({
      address: ADDR.tKRW,
      event: TRANSFER,
      args: { from: owner },
      fromBlock: blockNumber,
      toBlock: blockNumber,
    });
    if (logs.length > 0) return { ms: Math.round(performance.now() - t0), polls, found: true };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ms: Math.round(performance.now() - t0), polls: 100, found: false };
}

// ---------------------------------------------------------------------------
// ③ trigger-block — 차단 2종
// ---------------------------------------------------------------------------

async function step3() {
  stage("③ trigger-block — 건당 초과 · 미검증 수신처");

  for (const [kind, label, expected] of [
    ["pertx", "건당 초과", "PerTxCapExceeded"],
    ["recipient", "미검증 수신처", "RecipientNotVerified"],
  ] as const) {
    const { code, out } = run("scripts/trigger-block.ts", [], { KIND: kind });
    check("③", `${label} 브로드캐스트`, code === 0, `code=${code}`);

    const hash = triggeredHash(out);
    if (!hash) {
      check("③", `${label} tx 확인`, false, "tx 해시를 찾지 못했습니다");
      continue;
    }

    // trigger-block 은 브로드캐스트만 하고 끝난다 — 영수증을 기다려야 한다
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
    check("③", `${label} revert 확인`, receipt.status === "reverted", `${hash.slice(0, 10)}…`);
    check(
      "③",
      `${label} 자금 이동 없음`,
      receipt.logs.length === 0,
      `로그 ${receipt.logs.length}개 (실패 리딤은 로그를 남기지 않는다)`,
    );

    // 사유는 직전 블록에서 재실행해 얻는다 — 영수증에는 사유가 없다
    const { reason, rpcError } = await revertReason(hash, receipt.blockNumber);
    check(
      "③",
      `${label} 사유 = ${expected}`,
      reason?.startsWith(expected) === true,
      reason ?? rpcError ?? "미확인",
    );
  }
}

/**
 * 확정된 실패 tx를 재실행해 revert 사유를 얻는다.
 *
 * ⚠️ **영수증의 블록 번호는 `latest`보다 앞설 수 있다.** Flashblocks 엔드포인트는 아직
 *    정식 확정되지 않은 preconfirm 블록의 영수증을 돌려주기 때문이다 (실측: 영수증
 *    block 31960045 vs latest 31960043). 그 번호를 그대로 `eth_call`에 넣으면 revert가
 *    아니라 **빈 성공**이 돌아와 "사유 미확인"이 된다. 그래서
 *      ① 해당 블록이 정식 확정될 때까지 기다린 뒤 직전 블록에서 재실행하고
 *      ② 그래도 통과하면 `latest`에서 다시 시도한다.
 *    ①을 쓰는 이유는 누적 한도처럼 상태에 의존하는 사유는 tx 직전 상태에서 재실행해야
 *    정확하기 때문이다.
 */
async function revertReason(
  hash: Hex,
  blockNumber: bigint,
): Promise<{ reason?: string; rpcError?: string }> {
  const { decodeRevertFromError, extractRevertData } = await import("@jipsa/delegation");
  const tx = await client.getTransaction({ hash });

  // ① 블록이 정식 확정될 때까지 (최대 ~6초)
  for (let i = 0; i < 12; i++) {
    if ((await client.getBlockNumber()) >= blockNumber) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const attempt = async (at: bigint | undefined) => {
    try {
      await client.call({
        account: tx.from,
        to: tx.to ?? undefined,
        data: tx.input,
        ...(at !== undefined ? { blockNumber: at } : {}),
      });
      return { passed: true as const };
    } catch (e) {
      if (extractRevertData(e) === undefined) {
        const m = e instanceof Error ? e.message.split("\n")[0] : String(e);
        return { rpcError: m };
      }
      const decoded = decodeRevertFromError(e);
      return {
        reason: decoded?.args?.length
          ? `${decoded.reason}(${decoded.args.map(String).join(", ")})`
          : decoded?.reason,
      };
    }
  };

  // ② 직전 블록 → 실패하면 latest
  for (const at of [blockNumber - 1n, undefined]) {
    const r = await attempt(at);
    if (r.reason) return { reason: r.reason };
    if (r.rpcError) return { rpcError: `revert 데이터 없음 — ${r.rpcError}` };
  }
  return { rpcError: "재실행이 통과했다 — 사유를 특정할 수 없다" };
}

// ---------------------------------------------------------------------------
// ④ 게이지·잔액 대조
// ---------------------------------------------------------------------------

async function step4(hash: Hex, owner: Address, merchantA: Address, before: Balances, spent: bigint) {
  stage("④ 게이지·잔액이 온체인 상태와 일치하는지");

  const after = await readBalances(owner, merchantA);
  check(
    "④",
    "주인 잔액 감소분 = 결제 합계",
    before.owner - after.owner === spent,
    `${fmt(before.owner - after.owner)} (기대 ${fmt(spent)})`,
  );
  check(
    "④",
    "가맹처 잔액 증가분 = 결제 합계",
    after.merchant - before.merchant === spent,
    fmt(after.merchant - before.merchant),
  );

  const spentMap = (await client.readContract({
    address: ADDR.erc20TransferAmountEnforcer,
    abi: ABI.erc20TransferAmountEnforcer,
    functionName: "spentMap",
    args: [ADDR.delegationManager, hash],
  })) as bigint;
  check(
    "④",
    "누적 지출 게이지가 결제분을 반영",
    spentMap >= spent,
    `spentMap ${fmt(spentMap)} (이번 실행 ${fmt(spent)})`,
  );

  const periodTerms = delegationFromJson(
    JSON.parse(readFileSync(IN, "utf8")) as unknown,
  ).caveats.find((c) => c.enforcer.toLowerCase() === ADDR.periodTransferEnforcer.toLowerCase())!
    .terms;
  const [available] = (await client.readContract({
    address: ADDR.periodTransferEnforcer,
    abi: ABI.erc20PeriodTransferEnforcer,
    functionName: "getAvailableAmount",
    args: [hash, ADDR.delegationManager, periodTerms],
  })) as readonly [bigint, boolean, bigint];
  check("④", "오늘 남은 한도 조회 가능", available >= 0n, fmt(available));

  console.log(
    "\n    차단된 2건은 자금을 전혀 옮기지 않았습니다 — 위 잔액 대조가 그 증거입니다.",
  );
}

interface Balances {
  owner: bigint;
  merchant: bigint;
}

async function readBalances(owner: Address, merchant: Address): Promise<Balances> {
  const [o, m] = await Promise.all([
    client.readContract({
      address: ADDR.tKRW,
      abi: ABI.tKRW,
      functionName: "balanceOf",
      args: [owner],
    }) as Promise<bigint>,
    client.readContract({
      address: ADDR.tKRW,
      abi: ABI.tKRW,
      functionName: "balanceOf",
      args: [merchant],
    }) as Promise<bigint>,
  ]);
  return { owner: o, merchant: m };
}

// ---------------------------------------------------------------------------

async function main() {
  const merchantA = optionalAddress("MERCHANT_A") ?? DEMO.merchantA;

  console.log("JIPSA E2E 체크 — GIWA Sepolia 실체인");
  console.log(`  위임 파일 : ${IN}`);
  console.log(`  가맹처    : ${merchantA}`);

  const { hash, owner } = await step1();
  const before = await readBalances(owner, merchantA);
  console.log(`\n  시작 잔액 — 주인 ${fmt(before.owner)} · 가맹처 ${fmt(before.merchant)}`);

  const { spent } = await step2(owner, merchantA);
  await step3();
  await step4(hash, owner, merchantA, before, spent);

  const failed = checks.filter((c) => !c.passed);
  stage(`결과 — ${checks.length - failed.length}/${checks.length} 통과`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✗ ${f.step} ${f.name} — ${f.detail}`);
    console.log("\n촬영 불가 — 위 항목을 먼저 해결하세요.");
    process.exit(1);
  }

  console.log("  자동 검증은 전부 통과했습니다.\n");
  console.log("  남은 수동 단계 (Act 4 — 대본대로 사람이 해야 하는 장면):");
  console.log("    1. 대시보드에서 주인 지갑으로 [긴급 철회] 클릭 → disableDelegation 서명");
  console.log("    2. 결제 재시도로 차단 확인:");
  console.log("         pnpm -F @jipsa/agent agent -- --scenario revoked");
  console.log("       → CannotUseADisabledDelegation 이 나와야 합니다");
  console.log("    3. 리허설이었다면 되살리기:");
  console.log("         pnpm -F @jipsa/agent agent -- --enable");
  console.log("");
  console.log("  위 3단계까지 확인되면 촬영 가능 상태입니다.");
}

main().catch((e: unknown) => {
  console.error("");
  console.error("중단:", e instanceof Error ? e.message : e);
  process.exit(1);
});
