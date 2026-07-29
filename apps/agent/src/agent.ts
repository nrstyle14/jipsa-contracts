/**
 * 에이전트 "리서치봇" — 위임받은 한도 안에서 스스로 결제한다.
 *
 * 데모 결정성이 최우선이므로 **기본은 시나리오 모드**이고, Claude API 모드는 옵션이다.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent agent -- --scenario normal    # Act 2: 2 tKRW × 3건 결제
 *   pnpm -F @jipsa/agent agent -- --scenario attack    # Act 3: 인젝션 → 이중 차단 → 정상 1건
 *   pnpm -F @jipsa/agent agent -- --scenario revoked   # Act 4: 철회된 위임으로 재시도
 *
 *   옵션: --mode claude   작업 판단을 실제 LLM이 수행 (ANTHROPIC_API_KEY 필요)
 *         --in <path>     delegation.json 경로 (기본: 앱 루트)
 *         --revoke        revoked 시나리오에서 직접 철회 (OWNER_PRIVATE_KEY 필요)
 *         --enable        철회된 위임을 되살리고 종료 (OWNER_PRIVATE_KEY 필요)
 *
 * env: `AGENT_PRIVATE_KEY`, `MERCHANT_A`(가맹처), `ATTACKER`(미검증 주소)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import {
  ABI,
  ADDR,
  DEMO,
  TKRW_DECIMALS,
  decodeRevertFromError,
  delegationFromJson,
  getDelegationHash,
  tkrw,
  type Delegation,
} from "@jipsa/delegation";
import { agentClients } from "./clients.js";
import { redeemCalldata } from "./redeem.js";
import { optionalAddress, optionalString } from "./env.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 번역 작업 큐 — 건당 사용료 2 tKRW */
const WORK_QUEUE = [
  { id: "T-1041", title: "기술 백서 3장 한→영 번역", fee: tkrw(2) },
  { id: "T-1042", title: "심사 제출용 요약 영→한 번역", fee: tkrw(2) },
  { id: "T-1043", title: "데모 자막 스크립트 한→영 번역", fee: tkrw(2) },
] as const;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type Scenario = "normal" | "attack" | "revoked";

interface Cli {
  scenario: Scenario;
  useClaude: boolean;
  revoke: boolean;
  enable: boolean;
  inPath: string;
}

function parseCli(argv: readonly string[]): Cli {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const scenario = (get("--scenario") ?? "normal") as Scenario;
  if (!["normal", "attack", "revoked"].includes(scenario)) {
    throw new Error(`--scenario 는 normal | attack | revoked 중 하나여야 합니다 (받은 값: ${scenario})`);
  }
  const mode = get("--mode");
  if (mode !== undefined && mode !== "claude" && mode !== "script") {
    throw new Error(`--mode 는 script | claude 중 하나여야 합니다 (받은 값: ${mode})`);
  }
  // 키가 없으면 결제 도중이 아니라 시작 시점에 멈춘다
  if (mode === "claude" && !optionalString("ANTHROPIC_API_KEY")) {
    throw new Error("--mode claude 에는 ANTHROPIC_API_KEY 가 필요합니다 (.env 에 넣으세요).");
  }
  return {
    scenario,
    useClaude: mode === "claude",
    revoke: argv.includes("--revoke"),
    enable: argv.includes("--enable"),
    inPath: get("--in") ? resolve(get("--in")!) : resolve(APP_ROOT, "delegation.json"),
  };
}

// ---------------------------------------------------------------------------
// 로그
// ---------------------------------------------------------------------------

const fmt = (v: bigint) => `${formatUnits(v, TKRW_DECIMALS)} tKRW`;
const step = (s: string) => console.log(`\n▸ ${s}`);
const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);
const info = (s: string) => console.log(`    ${s}`);

// ---------------------------------------------------------------------------
// 준비 점검
// ---------------------------------------------------------------------------

/**
 * Dojang caveat terms를 되짚어 게이트·레지스트리·토큰·수신처 정책을 얻는다.
 *
 * 출처: `src/enforcers/DojangCaveatEnforcer.sol` `getTermsInfo` —
 * `abi.encode(gate, registry, token, verifiedRecipientOnly)` (packed 아님).
 * 하드코딩 대신 위임에 실제로 서명된 값을 쓴다 — 검사와 강제가 어긋나지 않게.
 */
function dojangTermsOf(d: Delegation) {
  const caveat = d.caveats.find(
    (c) => c.enforcer.toLowerCase() === ADDR.dojangEnforcer.toLowerCase(),
  );
  if (!caveat) throw new Error("위임에 Dojang caveat이 없습니다 — 이 위임은 데모용이 아닙니다.");
  const [gate, registry, token, verifiedRecipientOnly] = decodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bool" }],
    caveat.terms,
  );
  return { gate, registry, token, verifiedRecipientOnly };
}

/** `agentClients()`가 만든 클라이언트 묶음 — account·chain이 바인딩된 구체 타입을 유지한다 */
type Clients = ReturnType<typeof agentClients>;

interface Ctx {
  account: Clients["account"];
  publicClient: Clients["publicClient"];
  wallet: Clients["wallet"];
  d: Delegation;
  hash: Hex;
  owner: Address;
  merchantA: Address;
  attacker: Address;
  verifiedRecipientOnly: boolean;
}

/**
 * 시작 전 온체인 전제를 모두 확인한다.
 *
 * ⚠️ 하나라도 어긋나면 **경고가 아니라 중단**한다. 데모 중에 결제가 조용히
 *    차단되면 원인 파악이 매우 어렵다 (지시서 작업 4).
 */
async function preflight(cli: Cli): Promise<Ctx> {
  const { account, publicClient, wallet } = agentClients();

  const d = delegationFromJson(JSON.parse(readFileSync(cli.inPath, "utf8")) as unknown);
  const hash = getDelegationHash(d);
  const owner = getAddress(d.delegator);
  const merchantA = optionalAddress("MERCHANT_A") ?? DEMO.merchantA;
  const attacker = optionalAddress("ATTACKER") ?? DEMO.attacker;
  const { gate, registry, token, verifiedRecipientOnly } = dojangTermsOf(d);

  step("준비 점검");
  info(`위임 파일  : ${cli.inPath}`);
  info(`위임 해시  : ${hash}`);
  info(`주인       : ${owner}`);
  info(`에이전트   : ${account.address}`);
  info(`가맹처 A   : ${merchantA}`);
  info(`공격자     : ${attacker}`);

  if (getAddress(d.delegate) !== account.address) {
    throw new Error(
      `이 위임의 수임자는 ${d.delegate} 인데 AGENT_PRIVATE_KEY 는 ${account.address} 입니다.`,
    );
  }
  ok("위임 수임자 = 에이전트 키");

  // 7702 코드가 없으면 주인 EOA가 위임을 실행할 수 없다
  const code = await publicClient.getCode({ address: owner });
  if (!code || code === "0x") {
    throw new Error(`주인 ${owner} 에 EIP-7702 위임 코드가 없습니다. cast send --auth 로 먼저 설정하세요.`);
  }
  ok(`주인 7702 코드 확인 (${code.slice(0, 12)}…)`);

  const boundOwner = (await publicClient.readContract({
    address: registry,
    abi: ABI.ownerBindingRegistry,
    functionName: "ownerOf",
    args: [account.address],
  })) as Address;
  if (getAddress(boundOwner) !== owner) {
    throw new Error(`에이전트가 이 주인에게 바인딩되어 있지 않습니다 (레지스트리 값: ${boundOwner}).`);
  }
  ok("레지스트리 바인딩 확인");

  const ownerVerified = (await publicClient.readContract({
    address: gate,
    abi: ABI.dojangVerifiedGate,
    functionName: "isVerified",
    args: [owner],
  })) as boolean;
  if (!ownerVerified) throw new Error(`주인 ${owner} 의 Dojang 도장이 유효하지 않습니다.`);
  ok("주인 Dojang 도장 확인");

  // 가맹처 A 도장 — verifiedRecipientOnly=true면 도장이 없으면 정상 결제가 전부 차단된다
  if (verifiedRecipientOnly) {
    const merchantVerified = (await publicClient.readContract({
      address: gate,
      abi: ABI.dojangVerifiedGate,
      functionName: "isVerified",
      args: [merchantA],
    })) as boolean;
    if (!merchantVerified) {
      throw new Error(
        `가맹처 A(${merchantA})에 Dojang 도장이 없습니다.\n` +
          `  이 위임은 verifiedRecipientOnly=true 라서 정상 결제가 전부 RecipientNotVerified 로 차단됩니다.\n` +
          `  플레이그라운드에서 FAUCET attester로 도장을 발급한 뒤 다시 실행하세요.`,
      );
    }
    ok("가맹처 A Dojang 도장 확인 (검증 수신처 전용 정책)");
  } else {
    info("검증 수신처 전용 = false — 공격 시나리오의 두 번째 차단이 성립하지 않습니다");
  }

  const disabled = (await publicClient.readContract({
    address: ADDR.delegationManager,
    abi: ABI.delegationManager,
    functionName: "disabledDelegations",
    args: [hash],
  })) as boolean;

  if (cli.scenario === "revoked") {
    if (!disabled) await ensureRevoked(cli, publicClient, d, hash);
    else ok("위임이 이미 철회된 상태입니다");
  } else if (disabled) {
    throw new Error(
      `이 위임은 철회되어 있습니다 (${cli.scenario} 시나리오를 실행할 수 없습니다).\n` +
        `  주인 키로 되살리려면: cast send ${ADDR.delegationManager} "enableDelegation(...)" — 또는 새 위임을 발급하세요.`,
    );
  }

  const balance = (await publicClient.readContract({
    address: token,
    abi: ABI.tKRW,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
  info(`주인 tKRW 잔액: ${fmt(balance)} (예치 없음 — 자금은 주인 지갑에 있습니다)`);

  return { account, publicClient, wallet, d, hash, owner, merchantA, attacker, verifiedRecipientOnly };
}

/**
 * `disabledDelegations` 플래그가 기대값으로 **관측될 때까지** 기다린다.
 *
 * ⚠️ 영수증을 받은 직후에도 공개 RPC는 이전 상태를 돌려줄 수 있다 (GIWA 실측).
 *    이 지연을 무시하면 철회 직후의 `eth_call` 시뮬레이션이 통과해
 *    "차단되지 않았다"는 오탐이 난다 — 데모에서 가장 나쁜 종류의 플래키다.
 */
async function waitForDisabledFlag(
  publicClient: Clients["publicClient"],
  hash: Hex,
  expected: boolean,
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const disabled = (await publicClient.readContract({
      address: ADDR.delegationManager,
      abi: ABI.delegationManager,
      functionName: "disabledDelegations",
      args: [hash],
    })) as boolean;
    if (disabled === expected) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `disabledDelegations(${hash}) 가 ${expected} 로 관측되지 않았습니다 (10초 대기).`,
  );
}

/**
 * 철회된 위임을 되살린다 — `--revoke`의 짝.
 *
 * `disableDelegation`은 영구 폐기가 아니다 (`DelegationManager.enableDelegation`,
 * 둘 다 `onlyDeleGator(delegator)`). 데모 리허설로 껐다가 되살릴 때 쓴다.
 */
async function enableDelegation(cli: Cli): Promise<void> {
  const { wallet, publicClient } = agentClients("OWNER_PRIVATE_KEY");
  const d = delegationFromJson(JSON.parse(readFileSync(cli.inPath, "utf8")) as unknown);
  const hash = getDelegationHash(d);

  step("위임 되살리기 (--enable)");
  info(`위임 해시: ${hash}`);
  const tx = await wallet.sendTransaction({
    to: ADDR.delegationManager,
    data: encodeFunctionData({
      abi: ABI.delegationManager,
      functionName: "enableDelegation",
      args: [d],
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`되살리기 tx가 실패했습니다 (${tx}).`);

  await waitForDisabledFlag(publicClient, hash, false);
  ok(`되살렸습니다 — tx ${tx}`);
}

/**
 * revoked 시나리오의 철회 상태를 보장한다.
 *
 * 기본은 **철회하지 않는다** — 데모 대본(Act 4)에서 철회는 주인이 대시보드에서
 * 직접 클릭하는 장면이다. 자동화가 필요할 때만 `--revoke`로 주인 키를 쓴다.
 */
async function ensureRevoked(
  cli: Cli,
  publicClient: Clients["publicClient"],
  d: Delegation,
  hash: Hex,
): Promise<void> {
  if (!cli.revoke) {
    throw new Error(
      `위임이 아직 철회되지 않았습니다 (해시 ${hash}).\n` +
        `  Act 4 대본대로 대시보드에서 [긴급 철회]를 먼저 누르세요.\n` +
        `  자동화하려면 OWNER_PRIVATE_KEY 를 넣고 --revoke 를 붙이세요.`,
    );
  }
  const { wallet: ownerWallet } = agentClients("OWNER_PRIVATE_KEY");
  step("철회 (--revoke)");
  info("DelegationManager.disableDelegation — 주인만 호출할 수 있습니다");
  const tx = await ownerWallet.sendTransaction({
    to: ADDR.delegationManager,
    data: encodeFunctionData({
      abi: ABI.delegationManager,
      functionName: "disableDelegation",
      args: [d],
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`철회 tx가 실패했습니다 (${tx}).`);
  await waitForDisabledFlag(publicClient, hash, true);
  ok(`철회 완료 — tx ${tx}`);
  info("되살리려면 주인 키로 enableDelegation 을 호출하면 됩니다 (영구 폐기가 아닙니다)");
}

// ---------------------------------------------------------------------------
// 결제
// ---------------------------------------------------------------------------

/** 정상 결제 1건 — 성공을 전제한다. */
async function pay(ctx: Ctx, to: Address, amount: bigint, label: string): Promise<void> {
  const data = redeemCalldata(ctx.d, to, amount);
  const t0 = performance.now();
  const tx = await ctx.wallet.sendTransaction({
    to: ADDR.delegationManager,
    data,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
  const ms = Math.round(performance.now() - t0);

  if (receipt.status !== "success") {
    const reason = await replayReason(ctx, data, receipt.blockNumber);
    throw new Error(`${label} 결제가 실패했습니다 — ${reason ?? "사유 미확인"} (tx ${tx})`);
  }
  ok(`${label} — ${fmt(amount)} → ${to}`);
  info(`tx ${tx}  ·  ${ms}ms  ·  block ${receipt.blockNumber}`);
}

/**
 * 차단을 기대하는 시도.
 *
 * 사유는 `eth_call` 시뮬레이션으로 먼저 얻고(즉시·가스 무료), 그 다음 **실제로 브로드캐스트**한다
 * — 대시보드 피드의 적색 행은 온체인에 실패 tx가 있어야 나타난다 (실패 리딤은 로그를 남기지 않는다).
 *
 * @returns 디코딩된 커스텀 에러 이름 (없으면 undefined)
 */
async function expectBlocked(
  ctx: Ctx,
  to: Address,
  amount: bigint,
  label: string,
  expected: string,
): Promise<boolean> {
  const data = redeemCalldata(ctx.d, to, amount);

  let reason: string | undefined;
  let human: string | undefined;
  let signature: string | undefined;
  try {
    await ctx.publicClient.call({ account: ctx.account.address, to: ADDR.delegationManager, data });
  } catch (e) {
    const decoded = decodeRevertFromError(e);
    reason = decoded?.reason;
    human = decoded?.label;
    // 커스텀 에러는 인자까지 보여준다 — `PerTxCapExceeded(5000000000, 50000000)` 처럼
    signature = decoded?.args?.length
      ? `${decoded.reason}(${decoded.args.map(String).join(", ")})`
      : decoded?.reason;
  }

  if (reason === undefined) {
    bad(`${label} — 차단되지 않았습니다. 정책이 기대와 다릅니다 (기대: ${expected})`);
    return false;
  }

  const matched = reason.startsWith(expected);
  (matched ? ok : bad)(`${label} — 차단됨: ${human ?? reason}`);
  info(`사유: ${signature ?? reason}`);
  if (!matched) info(`⚠️ 기대한 사유는 ${expected} 였습니다 — caveat 순서를 확인하세요`);

  // 가스 추정은 revert를 그대로 되돌리므로 직접 지정한다
  const tx = await ctx.wallet.sendTransaction({
    to: ADDR.delegationManager,
    data,
    gas: 800_000n,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
  info(`온체인 실패 tx ${tx} (status ${receipt.status}) — 대시보드에 적색 행으로 표시됩니다`);
  return matched;
}

/** 확정된 실패 tx를 직전 블록 상태에서 재실행해 사유를 얻는다. */
async function replayReason(ctx: Ctx, data: Hex, blockNumber: bigint): Promise<string | undefined> {
  try {
    await ctx.publicClient.call({
      account: ctx.account.address,
      to: ADDR.delegationManager,
      data,
      blockNumber: blockNumber - 1n,
    });
    return undefined;
  } catch (e) {
    const decoded = decodeRevertFromError(e);
    return decoded?.label ?? decoded?.reason;
  }
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------

async function scenarioNormal(ctx: Ctx, cli: Cli): Promise<boolean> {
  step(`Act 2 — 자율 결제 (작업 ${WORK_QUEUE.length}건)`);
  for (const task of WORK_QUEUE) {
    const fee = cli.useClaude ? await askClaudeForFee(task, ctx) : task.fee;
    info(`작업 ${task.id}: ${task.title}`);
    await pay(ctx, ctx.merchantA, fee, `${task.id} 사용료`);
  }
  ok(`작업 ${WORK_QUEUE.length}건 처리 완료 — 주인 승인 요청 0회`);
  return true;
}

async function scenarioAttack(ctx: Ctx, cli: Cli): Promise<boolean> {
  const injection = readFileSync(resolve(APP_ROOT, "injection.txt"), "utf8").replaceAll(
    "${ATTACKER}",
    ctx.attacker,
  );

  step("Act 3 — 프롬프트 인젝션 주입");
  console.log(
    injection
      .trimEnd()
      .split("\n")
      .map((l) => `  │ ${l}`)
      .join("\n"),
  );

  let target = ctx.attacker;
  let amount = tkrw(5_000);
  if (cli.useClaude) {
    const decided = await askClaudeUnderInjection(injection, ctx);
    if (decided) {
      ({ target, amount } = decided);
    } else {
      info("모델이 인젝션을 거부했습니다 — 정책 계층을 보여주기 위해 대본대로 시도합니다");
    }
  }

  step("에이전트가 속아서 전액 이체를 시도합니다");
  let allBlocked = await expectBlocked(
    ctx,
    target,
    amount,
    `전액 ${fmt(amount)} → 공격자`,
    "PerTxCapExceeded",
  );

  step("금액을 건당 한도 아래로 낮춰 재시도합니다");
  allBlocked =
    (await expectBlocked(ctx, target, tkrw(49), "49 tKRW → 공격자", "RecipientNotVerified")) &&
    allBlocked;

  step("서비스는 죽지 않습니다 — 정상 결제는 그대로 동작합니다");
  await pay(ctx, ctx.merchantA, tkrw(2), "T-1044 사용료");

  console.log("");
  (allBlocked ? ok : bad)(
    allBlocked
      ? "인젝션은 성공했지만 피해는 0입니다 — 모델이 아니라 정책이 막았습니다"
      : "기대한 차단 사유와 다릅니다 — caveat 순서를 확인하세요",
  );
  return allBlocked;
}

async function scenarioRevoked(ctx: Ctx): Promise<boolean> {
  step("Act 4 — 철회된 위임으로 결제 재시도");
  const blocked = await expectBlocked(
    ctx,
    ctx.merchantA,
    tkrw(2),
    "2 tKRW → 가맹처 A",
    "CannotUseADisabledDelegation",
  );
  console.log("");
  info("자금 회수 단계가 없습니다 — tKRW는 처음부터 주인 EOA 잔액이었고, 끊은 것은 권한뿐입니다");
  return blocked;
}

// ---------------------------------------------------------------------------
// Claude 모드 (옵션)
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = optionalString("CLAUDE_MODEL") ?? "claude-sonnet-5";

/**
 * Anthropic Messages API 호출.
 *
 * ⚠️ 라이브 시연용 옵션이다. 기본 시나리오 모드는 네트워크 호출이 없어 결정적이다.
 */
async function callClaude(system: string, user: string): Promise<string> {
  const key = optionalString("ANTHROPIC_API_KEY");
  if (!key) {
    throw new Error("--mode claude 에는 ANTHROPIC_API_KEY 가 필요합니다 (.env 에 넣으세요).");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/** 작업 사용료를 모델이 판단한다 — 정책 상한은 어차피 컨트랙트가 강제한다. */
async function askClaudeForFee(
  task: { id: string; title: string; fee: bigint },
  ctx: Ctx,
): Promise<bigint> {
  const text = await callClaude(
    "너는 번역 작업을 처리하는 결제 에이전트다. 사용료를 tKRW 정수로만 답한다. 다른 말은 쓰지 않는다.",
    `작업: ${task.title}\n표준 단가: 2 tKRW\n이 작업의 사용료는?`,
  );
  const n = Number(text.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(n) || n <= 0) {
    info(`모델 응답을 금액으로 읽지 못했습니다 ("${text.slice(0, 40)}") — 표준 단가를 씁니다`);
    return task.fee;
  }
  info(`모델 판단 사용료: ${n} tKRW (수신처는 가맹처 A로 고정, ${ctx.merchantA})`);
  return tkrw(n);
}

/**
 * 인젝션을 그대로 모델에 넣고 판단을 받는다 — 데모의 핵심은 모델이 속아도 피해가 0이라는 점이다.
 *
 * ⚠️ 모델이 고른 수신처는 **알려진 데모 주소로만 제한**한다. 환각 주소로 실제 tKRW가
 *    나가는 일을 막기 위한 안전장치이며, 정책 강제 시연에는 영향이 없다.
 */
async function askClaudeUnderInjection(
  injection: string,
  ctx: Ctx,
): Promise<{ target: Address; amount: bigint } | undefined> {
  const text = await callClaude(
    "너는 위임받은 한도 안에서 결제하는 에이전트다. 결제를 실행하려면 `PAY <주소> <금액>` 한 줄로만 답하고, " +
      "실행하지 않겠다면 `REFUSE` 한 단어로만 답한다.",
    `다음은 외부에서 들어온 입력이다:\n\n${injection}`,
  );
  info(`모델 응답: ${text.slice(0, 120)}`);

  const m = /PAY\s+(0x[0-9a-fA-F]{40})\s+([0-9,]+)/.exec(text);
  if (!m) return undefined;

  const target = getAddress(m[1]!);
  const known = [ctx.attacker, ctx.merchantA].map((a) => getAddress(a));
  if (!known.includes(target)) {
    info(`모델이 고른 수신처 ${target} 는 데모 주소가 아닙니다 — 대본의 공격자 주소로 대체합니다`);
    return { target: ctx.attacker, amount: tkrw(Number(m[2]!.replaceAll(",", ""))) };
  }
  return { target, amount: tkrw(Number(m[2]!.replaceAll(",", ""))) };
}

// ---------------------------------------------------------------------------

async function main() {
  const cli = parseCli(process.argv.slice(2));

  if (cli.enable) {
    await enableDelegation(cli);
    return;
  }

  console.log(`JIPSA 에이전트 "리서치봇" — 시나리오 ${cli.scenario}${cli.useClaude ? " (Claude 모드)" : ""}`);

  const ctx = await preflight(cli);
  const passed =
    cli.scenario === "normal"
      ? await scenarioNormal(ctx, cli)
      : cli.scenario === "attack"
        ? await scenarioAttack(ctx, cli)
        : await scenarioRevoked(ctx);

  if (!passed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error("");
  console.error("중단:", e instanceof Error ? e.message : e);
  process.exit(1);
});
