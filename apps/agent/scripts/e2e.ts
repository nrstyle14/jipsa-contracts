/**
 * E2E 검증 — 지시서 작업 5의 완료 기준을 실제 GIWA Sepolia에서 순서대로 확인한다.
 *
 *   ① grant.ts로 위임 발급        ② normal 3건 결제 + 피드 반영 지연 측정
 *   ③ attack 2건 revert           ④ 철회 후 revoked revert
 *   ⑤ 게이지·잔액이 온체인 상태와 일치
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent e2e
 *
 * 옵션 (환경변수):
 *   OWNER_PRIVATE_KEY  필수 — 위임 발급 서명 + ④의 철회
 *   AGENT_PRIVATE_KEY  필수 — 결제 실행
 *   OUT                선택 — e2e 전용 위임 파일 (기본 apps/agent/e2e-delegation.json)
 *
 * ⚠️ **데모용 `delegation.json`은 건드리지 않는다.** e2e는 자기 위임을 새로 발급해
 *    쓰고 ④에서 그것을 철회한 채 끝낸다 — 데모 리허설이 망가지지 않게.
 *
 * ⚠️ **연속 실행은 공개 RPC 한도에 걸린다.** 한 번 도는 데 온체인 호출이 50건 이상이고,
 *    Dojang 검증처럼 무거운 `eth_call`이 섞여 있다. 실측에서 쉬지 않고 3회 돌리면
 *    2회차부터 `over rate limit`으로 실패했고, 회복에 1~2분이 걸렸다.
 *    재시도(retryCount 5)를 걸어뒀지만 한도 자체는 시간이 지나야 풀린다 —
 *    **연속 실행 사이에 1~2분을 두거나 전용 RPC(`RPC_URL`)를 쓸 것.**
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
const OUT = optionalString("OUT") ? resolve(optionalString("OUT")!) : resolve(APP_ROOT, "e2e-delegation.json");

const client = giwaPublicClient();
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const fmt = (v: bigint) => `${formatUnits(v, TKRW_DECIMALS)} tKRW`;

/** 지시서 작업 2의 고정 데모 정책 — grant.ts와 같은 값이어야 한다 */
const DAILY_CAP = tkrw(500);

// ---------------------------------------------------------------------------
// 결과 수집
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
 * 자식 프로세스로 스크립트를 실행한다.
 *
 * 실제 CLI를 그대로 돌린다 — 함수를 직접 부르면 CLI 파싱·중단 경로가 검증되지 않는다.
 */
function run(script: string, args: readonly string[], env: Record<string, string> = {}) {
  const r = spawnSync(TSX, [resolve(APP_ROOT, script), ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(
    out
      .trimEnd()
      .split("\n")
      .map((l) => `    │ ${l}`)
      .join("\n") + "\n",
  );
  return { code: r.status ?? -1, out };
}

/** 로그에서 `tx 0x…` 해시를 뽑는다 */
function txHashes(out: string): Hex[] {
  return [...out.matchAll(/tx\s+(0x[0-9a-fA-F]{64})/g)].map((m) => m[1] as Hex);
}

// ---------------------------------------------------------------------------
// ① 위임 발급
// ---------------------------------------------------------------------------

async function step1() {
  stage("① grant.ts 로 위임 발급");
  rmSync(OUT, { force: true });

  const { code } = run("scripts/grant.ts", [], { OUT });
  check("①", "grant.ts 종료 코드 0", code === 0, `code=${code}`);
  check("①", "위임 파일 생성", existsSync(OUT), OUT);
  if (!existsSync(OUT)) throw new Error("위임 파일이 없어 이후 단계를 진행할 수 없습니다.");

  const d = delegationFromJson(JSON.parse(readFileSync(OUT, "utf8")) as unknown);
  const localHash = getDelegationHash(d);

  // TS 인코딩을 컨트랙트가 계산한 해시와 맞춰본다 — 서명 대상이 어긋나면 여기서 잡힌다
  const onChainHash = (await client.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "getDelegationHash",
    args: [d],
  })) as Hex;
  check("①", "위임 해시 TS = 컨트랙트", localHash === onChainHash, localHash);
  check("①", "caveat 7종", d.caveats.length === 7, `${d.caveats.length}개`);

  return { d, hash: localHash, owner: d.delegator as Address };
}

// ---------------------------------------------------------------------------
// ② normal 3건 + 피드 반영 지연
// ---------------------------------------------------------------------------

async function step2(owner: Address, merchantA: Address) {
  stage("② normal 시나리오 — 2 tKRW × 3건 결제");

  const { code, out } = run("src/agent.ts", ["--scenario", "normal", "--in", OUT]);
  check("②", "normal 종료 코드 0", code === 0, `code=${code}`);

  const hashes = txHashes(out);
  check("②", "결제 3건", hashes.length === 3, `${hashes.length}건`);

  let allTransferred = hashes.length === 3;
  let lastBlock = 0n;
  for (const h of hashes) {
    const receipt = await client.getTransactionReceipt({ hash: h });
    const transfer = receipt.logs.find(
      (l) =>
        l.address.toLowerCase() === ADDR.tKRW.toLowerCase() &&
        l.topics[1]?.toLowerCase().endsWith(owner.slice(2).toLowerCase()) &&
        l.topics[2]?.toLowerCase().endsWith(merchantA.slice(2).toLowerCase()),
    );
    if (receipt.status !== "success" || !transfer) allTransferred = false;
    if (receipt.blockNumber > lastBlock) lastBlock = receipt.blockNumber;
  }
  check("②", "3건 모두 성공 + 가맹처 A로 Transfer", allTransferred, `마지막 block ${lastBlock}`);

  // 피드 반영 — 대시보드가 쓰는 것과 **동일한 쿼리**로 결제가 보이는지 확인한다.
  //
  // ⚠️ 게이트는 "보이는가"(결정적)로 두고 지연 시간은 **측정치로만 보고**한다.
  //    노드의 로그 인덱싱 지연은 RPC 부하에 따라 20ms ~ 1.7초로 흔들렸다 (실측).
  //    이걸 임계값으로 걸면 e2e가 간헐 실패해 게이트로 못 쓴다.
  const probe = await measureFeedLatency(owner, lastBlock);
  check("②", "피드 쿼리로 결제가 조회됨", probe.found, `getLogs 폴링 ${probe.polls}회`);
  console.log(
    `    ↳ 확정 → 로그 조회 지연 ${probe.ms}ms (참고값. 대시보드는 여기에 폴링 주기 1초가 더해진다)`,
  );
}

/**
 * 확정된 블록의 Transfer 로그가 `eth_getLogs`로 조회되기까지의 지연을 잰다.
 *
 * 대시보드 피드의 확정 경로는 tKRW `Transfer(from = owner)` 폴링이므로 같은 쿼리를 쓴다.
 * 노드가 로그 인덱스를 반영하는 데 걸리는 시간만 남기려고, 이미 확정된 블록을 대상으로 잰다.
 */
async function measureFeedLatency(owner: Address, blockNumber: bigint) {
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
// ③ attack — 2건 revert
// ---------------------------------------------------------------------------

function step3() {
  stage("③ attack 시나리오 — 인젝션 이중 차단");

  const { code, out } = run("src/agent.ts", ["--scenario", "attack", "--in", OUT]);
  check("③", "attack 종료 코드 0", code === 0, `code=${code}`);
  check("③", "1차 차단 PerTxCapExceeded", out.includes("PerTxCapExceeded("), "건당 한도");
  check("③", "2차 차단 RecipientNotVerified", out.includes("RecipientNotVerified("), "미검증 수신처");

  // 사유가 사람이 읽는 문장으로 나오는지 — 대시보드가 쓰는 것과 같은 디코더의 라벨이다
  check(
    "③",
    "사유가 한국어 문장으로 표시",
    out.includes("건당 한도를 초과했습니다") && out.includes("수신처에 Dojang 도장이 없습니다"),
    "KNOWN_CUSTOM 라벨",
  );
  check("③", "차단 후에도 정상 결제 성공", out.includes("T-1044 사용료"), "서비스 중단 없음");
}

// ---------------------------------------------------------------------------
// ④ 철회 → revoked revert
// ---------------------------------------------------------------------------

function step4() {
  stage("④ 철회 후 결제 재시도");
  console.log(
    "    데모 대본(Act 4)에서는 주인이 대시보드에서 [긴급 철회]를 누른다.\n" +
      "    자동화에서는 같은 `disableDelegation` 호출을 --revoke 로 대신한다.\n",
  );

  const { code, out } = run("src/agent.ts", ["--scenario", "revoked", "--revoke", "--in", OUT]);
  check("④", "revoked 종료 코드 0", code === 0, `code=${code}`);
  check(
    "④",
    "CannotUseADisabledDelegation revert",
    out.includes("CannotUseADisabledDelegation"),
    "철회된 위임",
  );
  check("④", "사유가 한국어 문장으로 표시", out.includes("철회된 위임입니다"), "KNOWN_CUSTOM 라벨");
}

// ---------------------------------------------------------------------------
// ⑤ 게이지·잔액 대조
// ---------------------------------------------------------------------------

async function step5(hash: Hex, owner: Address, merchantA: Address, before: Balances) {
  stage("⑤ 게이지·잔액이 온체인 상태와 일치하는지");

  // e2e가 이 위임으로 성공시킨 결제: normal 3건 + attack 꼬리 1건 = 4건 × 2 tKRW
  const expectedSpent = tkrw(2) * 4n;

  const after = await readBalances(owner, merchantA);
  const ownerDelta = before.owner - after.owner;
  const merchantDelta = after.merchant - before.merchant;

  check(
    "⑤",
    "주인 잔액 감소분 = 결제 합계",
    ownerDelta === expectedSpent,
    `${fmt(ownerDelta)} (기대 ${fmt(expectedSpent)})`,
  );
  check(
    "⑤",
    "가맹처 A 잔액 증가분 = 결제 합계",
    merchantDelta === expectedSpent,
    `${fmt(merchantDelta)}`,
  );

  const spent = (await client.readContract({
    address: ADDR.erc20TransferAmountEnforcer,
    abi: ABI.erc20TransferAmountEnforcer,
    functionName: "spentMap",
    args: [ADDR.delegationManager, hash],
  })) as bigint;
  check(
    "⑤",
    "누적 지출 게이지 = 결제 합계",
    spent === expectedSpent,
    `spentMap ${fmt(spent)}`,
  );

  const periodTerms = delegationFromJson(
    JSON.parse(readFileSync(OUT, "utf8")) as unknown,
  ).caveats.find(
    (c) => c.enforcer.toLowerCase() === ADDR.periodTransferEnforcer.toLowerCase(),
  )!.terms;
  const [available] = (await client.readContract({
    address: ADDR.periodTransferEnforcer,
    abi: ABI.erc20PeriodTransferEnforcer,
    functionName: "getAvailableAmount",
    args: [hash, ADDR.delegationManager, periodTerms],
  })) as readonly [bigint, boolean, bigint];
  check(
    "⑤",
    "오늘 남은 한도 = 일간 한도 − 결제 합계",
    available === DAILY_CAP - expectedSpent,
    `${fmt(available)} (기대 ${fmt(DAILY_CAP - expectedSpent)})`,
  );

  const disabled = (await client.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "disabledDelegations",
    args: [hash],
  })) as boolean;
  check("⑤", "위임이 철회 상태로 남음", disabled, "e2e 전용 위임 — 데모 위임은 무영향");

  // 차단된 시도가 자금을 옮기지 않았음을 위 두 잔액 대조가 이미 증명한다
  console.log(
    "\n    차단된 3건(전액·49·철회후)은 자금을 전혀 옮기지 않았습니다 — 잔액 대조로 증명됩니다.",
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

  console.log("JIPSA E2E 검증 — GIWA Sepolia 실체인");
  console.log(`  위임 파일 : ${OUT} (데모용 delegation.json 은 건드리지 않습니다)`);
  console.log(`  가맹처 A  : ${merchantA}`);

  const { hash, owner } = await step1();
  const before = await readBalances(owner, merchantA);
  console.log(`\n  시작 잔액 — 주인 ${fmt(before.owner)} · 가맹처 A ${fmt(before.merchant)}`);

  await step2(owner, merchantA);
  step3();
  step4();
  await step5(hash, owner, merchantA, before);

  const failed = checks.filter((c) => !c.passed);
  stage(`결과 — ${checks.length - failed.length}/${checks.length} 통과`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✗ ${f.step} ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  console.log("  모든 완료 기준을 통과했습니다.");
}

main().catch((e: unknown) => {
  console.error("");
  console.error("중단:", e instanceof Error ? e.message : e);
  process.exit(1);
});
