/**
 * 에이전트 데몬 — 상주하며 주기적으로 결제하고, 대시보드의 제어를 받는다 (시나리오 v2).
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent daemon
 *   pnpm -F @jipsa/agent daemon -- --interval 10000 --port 8788
 *
 *   옵션: --interval <ms>  결제 주기 (기본 30000)
 *         --amount <tKRW>  건당 금액 (기본 2)
 *         --port <n>       제어 서버 포트 (기본 8787)
 *         --in <path>      위임 파일 (기본 apps/agent/delegation.json)
 *
 * 제어 API (대시보드가 호출):
 *   GET  /status   현재 상태 — 대시보드의 "동작 중" 배지 근거
 *   POST /inject   프롬프트 인젝션 주입 → 에이전트가 속아서 시도 → 온체인 이중 차단
 *   POST /pay-now  즉시 1건 결제 (촬영 중 주기를 기다리지 않으려고)
 *
 * ⚠️ **주기를 촘촘히 하지 말 것.** 공개 RPC는 무거운 호출을 몰아치면 `over rate limit`으로
 *    거절하고 회복에 1~2분이 걸린다 (실측). 30초는 그 한도를 피하려고 고른 값이다.
 *    한도에 걸리면 이번 주기를 건너뛰고 상태에 남긴다 — 죽지 않는다.
 *
 * ⚠️ 개인키는 env로만 받는다. 제어 API는 키를 노출하지도, 받지도 않는다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits, type Address, type Hex } from "viem";
import {
  DEMO,
  TKRW_DECIMALS,
  decodeRevertFromError,
  delegationFromJson,
  getDelegationHash,
  tkrw,
  type Delegation,
} from "@jipsa/delegation";
import { agentClients } from "./clients.js";
import { DELEGATION_MANAGER, redeemCalldata } from "./redeem.js";
import { optionalAddress, optionalString } from "./env.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 제어를 허용할 대시보드 origin.
 *
 * 기본은 로컬 vite dev 두 개뿐이다. 배포된 대시보드(예: Vercel)에서 로컬 데몬을 부르려면
 * `DASHBOARD_ORIGIN`에 콤마로 나열한다 — 그때는 HTTPS 터널이 필요하다(혼합 콘텐츠 차단).
 *
 * ⚠️ 아무 origin이나 열지 말 것. /inject 는 실제 tx를 브로드캐스트한다. 피해는 caveat
 *    안으로 제한되지만(건당 50 · 일간 500), 남이 마음대로 트리거할 이유는 없다.
 */
const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ALLOWED_ORIGINS = (optionalString("DASHBOARD_ORIGIN") ?? LOCAL_ORIGINS.join(","))
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * 쓰기 엔드포인트 토큰.
 *
 * ⚠️ **CORS는 보호 장치가 아니다.** 브라우저만 지키고 `curl`은 무시한다. 지금 실제 보호는
 *    서버가 loopback(127.0.0.1)에만 바인딩된다는 점뿐이다. 그런데 터널(ngrok·cloudflared)로
 *    노출하는 순간 `/inject`·`/pay-now`가 **URL을 아는 누구에게나** 열린다 —
 *    `/inject`는 실제 tx를 브로드캐스트한다 (피해는 caveat 안이지만 남이 트리거할 이유가 없다).
 *
 *    그래서 규칙을 둔다:
 *      · `DAEMON_TOKEN`이 설정돼 있으면 쓰기 요청에 `x-jipsa-token` 헤더가 일치해야 한다
 *      · 설정돼 있지 않으면 **로컬 origin 외의 쓰기 요청을 거부**한다
 *    즉 원격 노출은 토큰 없이는 불가능하다.
 */
const DAEMON_TOKEN = optionalString("DAEMON_TOKEN");

/**
 * 인젝션 대본 — 대시보드 팝업이 이 문구를 그대로 보여준다.
 * `${ATTACKER}` 자리를 실제 주소로 채워서 내보낸다 (화면에 플레이스홀더가 보이면 안 된다).
 */
function injectionText(attacker: Address): string {
  return readFileSyncSafe(resolve(APP_ROOT, "injection.txt")).replaceAll("${ATTACKER}", attacker);
}

function readFileSyncSafe(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "(injection.txt 를 읽지 못했습니다)";
  }
}

const fmt = (v: bigint) => `${formatUnits(v, TKRW_DECIMALS)} tKRW`;
const stamp = () => new Date().toLocaleTimeString("ko-KR");
const log = (s: string) => console.log(`[${stamp()}] ${s}`);

/** 레이트 리밋인지 — 이 경우는 오류가 아니라 "잠시 후 다시"로 다뤄야 한다 */
function isRateLimited(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /over rate limit|rate limit|429|too many requests/i.test(m);
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

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
  return {
    interval: Math.floor(num("--interval", 30_000)),
    amount: tkrw(num("--amount", 2)),
    port: Math.floor(num("--port", 8787)),
    inPath: get("--in") ? resolve(get("--in")!) : resolve(APP_ROOT, "delegation.json"),
  };
}

type Cli = ReturnType<typeof parseCli>;

// ---------------------------------------------------------------------------
// 상태 — /status 가 그대로 돌려준다
// ---------------------------------------------------------------------------

interface Blocked {
  hash: Hex;
  amount: string;
  to: Address;
  reason?: string;
  label?: string;
}

const state = {
  startedAt: new Date().toISOString(),
  agent: "" as string,
  delegationHash: undefined as Hex | undefined,
  /** 위임 파일이 없으면 결제하지 않고 대기한다 */
  waitingForDelegation: true,
  intervalMs: 0,
  paymentsMade: 0,
  lastPaymentAt: undefined as string | undefined,
  lastPaymentHash: undefined as Hex | undefined,
  /** 마지막 주기가 레이트 리밋으로 건너뛰어졌나 */
  rateLimited: false,
  rateLimitedUntil: undefined as string | undefined,
  lastError: undefined as string | undefined,
  /** 인젝션 시도 결과 — 대시보드 토스트가 참고한다 */
  lastInjectionAt: undefined as string | undefined,
  lastInjectionBlocked: [] as Blocked[],
  busy: false,
};

// ---------------------------------------------------------------------------
// 결제
// ---------------------------------------------------------------------------

type Clients = ReturnType<typeof agentClients>;

function loadDelegation(cli: Cli): Delegation | undefined {
  if (!existsSync(cli.inPath)) return undefined;
  try {
    return delegationFromJson(JSON.parse(readFileSync(cli.inPath, "utf8")) as unknown);
  } catch (e) {
    state.lastError = `위임 파일을 읽지 못했습니다: ${firstLine(e)}`;
    return undefined;
  }
}

/**
 * 결제 1건. 성공·차단·리밋을 구분해 돌려준다.
 *
 * @dev 가스를 직접 넘긴다 — `eth_estimateGas`가 리딤당 수백 ms 걸리고(DojangCaveatEnforcer가
 *      EAS 스토리지를 많이 읽는다) 그만큼 리밋에 가까워진다. 첫 리딤이 가장 비싸므로
 *      넉넉한 고정값이면 안전하다.
 */
const FIXED_GAS = 600_000n;

async function payOnce(
  c: Clients,
  d: Delegation,
  to: Address,
  amount: bigint,
): Promise<
  | { kind: "ok"; hash: Hex; ms: number }
  | { kind: "blocked"; hash: Hex; reason?: string; label?: string }
  | { kind: "rateLimited" }
  | { kind: "error"; message: string }
> {
  const data = redeemCalldata(d, to, amount);
  const t0 = performance.now();
  let hash: Hex;
  try {
    hash = await c.wallet.sendTransaction({ to: DELEGATION_MANAGER, data, gas: FIXED_GAS });
  } catch (e) {
    if (isRateLimited(e)) return { kind: "rateLimited" };
    // 전송 단계에서 revert가 잡히는 경우도 있다 (노드가 미리 시뮬레이션)
    const decoded = decodeRevertFromError(e);
    if (decoded) return { kind: "blocked", hash: "0x" as Hex, reason: decoded.reason, label: decoded.label };
    return { kind: "error", message: firstLine(e) };
  }

  try {
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status === "success") {
      return { kind: "ok", hash, ms: Math.round(performance.now() - t0) };
    }
    const decoded = await replayReason(c, data, receipt.blockNumber);
    return { kind: "blocked", hash, reason: decoded?.reason, label: decoded?.label };
  } catch (e) {
    if (isRateLimited(e)) return { kind: "rateLimited" };
    return { kind: "error", message: firstLine(e) };
  }
}

/**
 * 실패한 tx를 재실행해 사유를 얻는다.
 *
 * ⚠️ 영수증의 블록 번호는 `latest`보다 앞설 수 있다 — Flashblocks가 preconfirm 블록의
 *    영수증을 주기 때문이다. 그 번호로 호출하면 revert가 아니라 빈 성공이 돌아온다.
 *    확정을 기다린 뒤 직전 블록에서, 그래도 통과하면 latest 에서 다시 시도한다.
 */
async function replayReason(c: Clients, data: Hex, blockNumber: bigint) {
  for (let i = 0; i < 6; i++) {
    if ((await c.publicClient.getBlockNumber()) >= blockNumber) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const at of [blockNumber - 1n, undefined] as const) {
    try {
      await c.publicClient.call({
        account: c.account.address,
        to: DELEGATION_MANAGER,
        data,
        ...(at !== undefined ? { blockNumber: at } : {}),
      });
    } catch (e) {
      const decoded = decodeRevertFromError(e);
      if (decoded) return decoded;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 인젝션 — 에이전트가 "속는" 행위는 미리 코드로 정해져 있다
// ---------------------------------------------------------------------------

/**
 * 프롬프트 인젝션에 속은 에이전트의 행동.
 *
 * 대본(Act 3)이 요구하는 순서를 그대로 코드로 고정했다 — 전액을 시도하고, 건당 한도에
 * 걸리면 금액을 낮춰 재시도한다. LLM에게 판단을 맡기면 데모가 비결정적이 되고, 모델이
 * 인젝션을 거부해 버리면 장면 자체가 성립하지 않는다.
 *
 * 두 시도 모두 **실제로 브로드캐스트**한다. 실패 리딤은 로그를 남기지 않으므로,
 * 대시보드의 적색 행은 온체인에 실패 tx가 있어야 나타난다.
 */
async function runInjection(c: Clients, d: Delegation, attacker: Address): Promise<Blocked[]> {
  const out: Blocked[] = [];
  for (const amount of [tkrw(5_000), tkrw(49)]) {
    log(`인젝션에 속아 시도: ${fmt(amount)} → ${attacker}`);
    const r = await payOnce(c, d, attacker, amount);
    if (r.kind === "blocked") {
      log(`  차단됨: ${r.label ?? r.reason ?? "사유 미확인"}`);
      out.push({ hash: r.hash, amount: fmt(amount), to: attacker, reason: r.reason, label: r.label });
    } else if (r.kind === "ok") {
      // 여기 오면 정책이 기대와 다르다 — 조용히 넘기면 안 된다
      log(`  ⚠️ 차단되지 않았다! tx ${r.hash} — 정책을 확인하세요`);
      out.push({ hash: r.hash, amount: fmt(amount), to: attacker, reason: "NOT_BLOCKED" });
    } else if (r.kind === "rateLimited") {
      log("  RPC 한도에 걸려 시도하지 못했습니다 — 잠시 후 다시 주입하세요");
      out.push({ hash: "0x" as Hex, amount: fmt(amount), to: attacker, reason: "RATE_LIMITED" });
      break;
    } else {
      log(`  오류: ${r.message}`);
      out.push({ hash: "0x" as Hex, amount: fmt(amount), to: attacker, reason: r.message });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 제어 서버
// ---------------------------------------------------------------------------

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type,x-jipsa-token");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    // Chrome의 Private Network Access — 공개 페이지가 사설망 주소를 부를 때 요구한다
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("access-control-allow-private-network", "true");
    }
  }
}

/**
 * 쓰기 요청을 거부할 이유 — 없으면 undefined.
 *
 * origin 이 없는 요청(로컬 curl 등)은 loopback 바인딩상 반드시 로컬이므로 허용한다.
 */
function writeDenied(req: IncomingMessage): string | undefined {
  const token = req.headers["x-jipsa-token"];
  if (DAEMON_TOKEN) {
    return token === DAEMON_TOKEN ? undefined : "DAEMON_TOKEN 이 일치하지 않습니다";
  }
  const origin = req.headers.origin;
  if (origin && !LOCAL_ORIGINS.includes(origin)) {
    return "원격 origin 에서 쓰기 요청을 하려면 DAEMON_TOKEN 을 설정하세요";
  }
  return undefined;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** busy 가 풀릴 때까지 기다린다. 시간 내에 안 풀리면 false */
async function waitIdle(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (state.busy) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

function startServer(cli: Cli, ctx: () => { c: Clients; d: Delegation | undefined; attacker: Address }) {
  const server = createServer((req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/status") {
      json(res, 200, { ...state, injectionText: injectionText(ctx().attacker) });
      return;
    }

    const isInject = url.pathname === "/inject";
    if (req.method === "POST" && (isInject || url.pathname === "/pay-now")) {
      const denied = writeDenied(req);
      if (denied) {
        json(res, 403, { error: denied });
        return;
      }
      const { c, d, attacker } = ctx();
      if (!d) {
        json(res, 409, { error: "위임이 없습니다 — delegation.json 을 전달하세요" });
        return;
      }
      const delegation = d; // 아래 async 클로저에서 좁혀진 타입을 유지한다

      void (async () => {
        // 주기 결제와 겹치면 버튼이 실패한다 — 즉시 거절하지 않고 잠깐 기다린다
        if (!(await waitIdle(12_000))) {
          json(res, 409, { error: "직전 작업이 진행 중입니다 — 잠시 후 다시 누르세요" });
          return;
        }
        state.busy = true;
        try {
          if (isInject) {
            const blocked = await runInjection(c, delegation, attacker);
            state.lastInjectionAt = new Date().toISOString();
            state.lastInjectionBlocked = blocked;
            json(res, 200, { blocked });
          } else {
            json(res, 200, await payCycle(c, delegation, cli, "요청"));
          }
        } catch (e) {
          json(res, 500, { error: firstLine(e) });
        } finally {
          state.busy = false;
        }
      })();
      return;
    }

    json(res, 404, { error: "없는 경로" });
  });

  server.listen(cli.port, "127.0.0.1", () => {
    log(`제어 서버 http://127.0.0.1:${cli.port} (status · inject · pay-now)`);
  });
  return server;
}

// ---------------------------------------------------------------------------
// 주기 루프
// ---------------------------------------------------------------------------

async function payCycle(c: Clients, d: Delegation, cli: Cli, why: string) {
  const merchant = optionalAddress("MERCHANT_A") ?? DEMO.merchantA;
  const r = await payOnce(c, d, merchant, cli.amount);

  if (r.kind === "ok") {
    state.paymentsMade++;
    state.lastPaymentAt = new Date().toISOString();
    state.lastPaymentHash = r.hash;
    state.rateLimited = false;
    state.lastError = undefined;
    log(`${why} 결제 ✓ ${fmt(cli.amount)} → 가맹처 A · ${r.ms}ms · ${r.hash}`);
    return { ok: true, hash: r.hash };
  }
  if (r.kind === "rateLimited") {
    state.rateLimited = true;
    state.rateLimitedUntil = new Date(Date.now() + cli.interval).toISOString();
    log("RPC 한도에 걸려 이번 주기를 건너뜁니다 — 지금은 안 되고 잠시 후 다시 시도합니다");
    return { ok: false, rateLimited: true };
  }
  if (r.kind === "blocked") {
    state.lastError = `차단됨: ${r.label ?? r.reason ?? "사유 미확인"}`;
    log(`${why} 결제 ✗ 차단됨: ${r.label ?? r.reason}`);
    return { ok: false, blocked: r.reason };
  }
  state.lastError = r.message;
  log(`${why} 결제 ✗ 오류: ${r.message}`);
  return { ok: false, error: r.message };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const c = agentClients();
  const attacker = optionalAddress("ATTACKER") ?? DEMO.attacker;

  state.agent = c.account.address;
  state.intervalMs = cli.interval;

  console.log('JIPSA 에이전트 데몬 "리서치봇"');
  console.log("  에이전트  :", c.account.address);
  console.log("  가맹처 A  :", optionalAddress("MERCHANT_A") ?? DEMO.merchantA);
  console.log("  공격자    :", attacker);
  console.log("  주기      :", `${cli.interval}ms · 건당 ${fmt(cli.amount)}`);
  console.log("  위임 파일 :", cli.inPath);
  console.log("");

  let d = loadDelegation(cli);
  state.waitingForDelegation = !d;
  state.delegationHash = d ? getDelegationHash(d) : undefined;
  if (!d) log("위임 없음 — 대기 중 (delegation.json 이 놓이면 자동으로 시작합니다)");
  else log(`위임 확인 ${state.delegationHash}`);

  startServer(cli, () => ({ c, d, attacker }));

  // 주기 루프 — 어떤 오류에도 죽지 않는다
  for (;;) {
    await new Promise((r) => setTimeout(r, cli.interval));

    // 위임 파일이 뒤늦게 놓이거나 교체될 수 있다 (마법사가 새로 발급하면 해시가 바뀐다)
    const reloaded = loadDelegation(cli);
    const hash = reloaded ? getDelegationHash(reloaded) : undefined;
    if (hash !== state.delegationHash) {
      d = reloaded;
      state.delegationHash = hash;
      state.waitingForDelegation = !d;
      log(d ? `위임 갱신 ${hash}` : "위임이 사라졌습니다 — 대기 중");
    }
    if (!d) continue;
    if (state.busy) continue; // 대시보드 요청과 겹치지 않게

    state.busy = true;
    try {
      await payCycle(c, d, cli, "주기");
    } catch (e) {
      state.lastError = firstLine(e);
      log(`주기 루프 오류(무시하고 계속): ${state.lastError}`);
    } finally {
      state.busy = false;
    }
  }
}

main().catch((e: unknown) => {
  console.error("");
  console.error("중단:", e instanceof Error ? e.message : e);
  process.exit(1);
});
