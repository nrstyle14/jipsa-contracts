/**
 * 정상 결제 실브로드캐스트 — Act 2 데모용 (지시서 v1.1 추가 B).
 *
 * `delegation.json`을 읽어 가맹처에 `redeemDelegations`로 결제한다.
 * 각 건의 tx 해시와 **전송 → preconfirm 시간**을 찍어 Flashblocks 체감 수치를 남긴다.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent pay                                  # 2 tKRW 1건
 *   pnpm -F @jipsa/agent pay -- --count 10 --interval 3000     # 데모: 2 tKRW × 10회 × 3초
 *   pnpm -F @jipsa/agent pay -- --amount 5 --count 3
 *
 *   옵션: --amount <tKRW>  기본 2
 *         --count <N>      기본 1
 *         --interval <ms>  기본 3000 (건 사이 대기)
 *         --to <주소>      기본 MERCHANT_A env 또는 DEMO.merchantA
 *         --in <path>      기본 apps/agent/delegation.json
 *
 * env: `AGENT_PRIVATE_KEY` 필수 · `MERCHANT_A` 선택
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import {
  DEMO,
  TKRW_DECIMALS,
  decodeRevertFromError,
  delegationFromJson,
  getDelegationHash,
  tkrw,
} from "@jipsa/delegation";
import { agentClients } from "../src/clients.js";
import { DELEGATION_MANAGER, redeemCalldata } from "../src/redeem.js";
import { optionalAddress, optionalString } from "../src/env.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * preconfirm 관측 폴링 간격.
 *
 * Flashblocks는 ~200ms 서브블록이라 촘촘히 봐야 체감 수치가 나온다. 다만 공개 RPC는
 * 무거운 호출을 몰아치면 `over rate limit`으로 거절하므로(실측), 건당 최대 관측
 * 시간을 제한하고 건 사이에 `--interval` 만큼 쉰다.
 */
const PRECONFIRM_POLL_MS = 120;
const PRECONFIRM_MAX_POLLS = 50;

function parseCli(argv: readonly string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const num = (flag: string, dflt: number) => {
    const raw = get(flag);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} 값이 올바르지 않습니다: ${raw}`);
    return n;
  };
  const to = get("--to");
  return {
    amount: tkrw(num("--amount", 2)),
    count: Math.floor(num("--count", 1)),
    interval: Math.floor(num("--interval", 3_000)),
    to: to ? getAddress(to) : (optionalAddress("MERCHANT_A") ?? DEMO.merchantA),
    inPath: get("--in") ? resolve(get("--in")!) : resolve(APP_ROOT, "delegation.json"),
  };
}

const fmt = (v: bigint) => `${formatUnits(v, TKRW_DECIMALS)} tKRW`;

/**
 * 전송 후 영수증이 처음 보이는 시점까지 잰다.
 *
 * @dev Flashblocks 엔드포인트는 블록이 정식 확정되기 전의 preconfirm 상태에서도
 *      영수증을 돌려준다. 그래서 이 값이 "체감 확정" 시간이다. 일반 RPC로 재면
 *      더 늦게 나오므로 두 값을 섞어 보고하지 않는다.
 */
async function waitPreconfirm(
  client: ReturnType<typeof agentClients>["publicClient"],
  hash: Hex,
) {
  for (let polls = 1; polls <= PRECONFIRM_MAX_POLLS; polls++) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      return { receipt, polls };
    } catch {
      // 아직 관측되지 않음 — 계속 본다
    }
    await new Promise((r) => setTimeout(r, PRECONFIRM_POLL_MS));
  }
  return { receipt: undefined, polls: PRECONFIRM_MAX_POLLS };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const { account, publicClient, wallet } = agentClients();
  const d = delegationFromJson(JSON.parse(readFileSync(cli.inPath, "utf8")) as unknown);

  console.log("정상 결제 브로드캐스트");
  console.log("  위임 해시 :", getDelegationHash(d));
  console.log("  에이전트  :", account.address);
  console.log("  수신처    :", cli.to);
  console.log(
    `  계획      : ${fmt(cli.amount)} × ${cli.count}회` +
      (cli.count > 1 ? ` · 간격 ${cli.interval}ms` : ""),
  );
  console.log("");

  /**
   * 가스는 한 번만 추정해 재사용한다.
   *
   * `eth_estimateGas`가 리딤 1건당 수백 ms 걸린다 — DojangCaveatEnforcer가 EAS 스토리지를
   * 많이 읽기 때문이다(같은 이유로 일반 RPC는 429가 잦다). 첫 리딤이 enforcer 스토리지를
   * 초기화하므로 이후 건은 더 싸다 → 첫 추정값 + 20% 여유면 안전하다.
   */
  const probeData = redeemCalldata(d, cli.to as Address, cli.amount);
  const estimated = await publicClient.estimateGas({
    account: account.address,
    to: DELEGATION_MANAGER,
    data: probeData,
  });
  const gas = (estimated * 12n) / 10n;
  console.log(`  가스      : ${estimated} 추정 → ${gas} 사용 (1회만 추정)`);
  console.log("");

  const latencies: number[] = [];
  let failed = 0;

  for (let i = 1; i <= cli.count; i++) {
    const data = redeemCalldata(d, cli.to as Address, cli.amount);
    const t0 = performance.now();
    let hash: Hex;
    try {
      hash = await wallet.sendTransaction({ to: DELEGATION_MANAGER, data, gas });
    } catch (e) {
      const decoded = decodeRevertFromError(e);
      failed++;
      console.log(`  ✗ ${i}/${cli.count} 전송 실패 — ${decoded?.label ?? decoded?.reason ?? "원인 불명"}`);
      continue;
    }
    const submittedAt = performance.now();
    const submitMs = Math.round(submittedAt - t0);

    const { receipt, polls } = await waitPreconfirm(publicClient, hash);
    // ⚠️ 체인 지연은 **제출 이후**만 잰다. 제출 시간에는 서명·RPC 왕복이 섞여 있어
    //    합쳐서 보고하면 Flashblocks의 실제 속도를 과소평가한다.
    const preconfirmMs = Math.round(performance.now() - submittedAt);

    if (!receipt) {
      failed++;
      console.log(`  ✗ ${i}/${cli.count} ${hash} — ${PRECONFIRM_MAX_POLLS}회 관측에도 영수증 없음`);
    } else if (receipt.status !== "success") {
      failed++;
      const reason = await replayReason(publicClient, account.address, data, receipt.blockNumber);
      console.log(`  ✗ ${i}/${cli.count} ${hash} — 차단됨: ${reason ?? "사유 미확인"}`);
    } else {
      latencies.push(preconfirmMs);
      console.log(
        `  ✓ ${i}/${cli.count} ${hash}\n` +
          `      제출 ${submitMs}ms · 제출→preconfirm ${preconfirmMs}ms (관측 ${polls}회) · block ${receipt.blockNumber}`,
      );
    }

    if (i < cli.count) await new Promise((r) => setTimeout(r, cli.interval));
  }

  console.log("");
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(
      `성공 ${latencies.length}건 · 제출→preconfirm 중앙값 ${median}ms ` +
        `(최소 ${sorted[0]}ms · 최대 ${sorted[sorted.length - 1]}ms)`,
    );
  }
  if (failed > 0) {
    console.log(`실패 ${failed}건`);
    process.exit(1);
  }
}

/** 실패한 tx를 직전 블록 상태에서 재실행해 사유를 얻는다 */
async function replayReason(
  client: ReturnType<typeof agentClients>["publicClient"],
  from: Address,
  data: Hex,
  blockNumber: bigint,
): Promise<string | undefined> {
  try {
    await client.call({ account: from, to: DELEGATION_MANAGER, data, blockNumber: blockNumber - 1n });
    return undefined;
  } catch (e) {
    const decoded = decodeRevertFromError(e);
    return decoded?.label ?? decoded?.reason;
  }
}

main().catch((e: unknown) => {
  console.error("");
  console.error("중단:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
