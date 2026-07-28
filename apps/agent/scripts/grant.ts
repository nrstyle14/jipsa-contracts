/**
 * 위임 발급 CLI — 주인 키로 EIP-712 서명한 위임을 `delegation.json`에 저장한다.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent grant
 *
 * 옵션 (환경변수):
 *   OWNER_PRIVATE_KEY  필수 — 도장 보유 + 7702 코드 보유 주인 EOA의 키
 *   AGENT_ADDRESS      선택 — 기본값은 DEMO.agent
 *   RPC_URL            선택 — 기본값은 Flashblocks 엔드포인트 (일반 RPC는 429가 잦다)
 *   OUT                선택 — 기본값 apps/agent/delegation.json
 *                      (상대경로는 CWD 기준. 기본값은 CWD와 무관하게 앱 루트에 쓴다)
 *
 * ⚠️ 개인키는 env로만 받는다. 코드·로그·커밋에 남기지 않는다.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ADDR,
  CHAIN_ID,
  DEMO,
  FLASHBLOCKS_RPC_URL,
  buildCaveats,
  delegationToJson,
  delegationTypedData,
  getDelegationHash,
  startDateFromChain,
  tkrw,
  ROOT_AUTHORITY,
  type Delegation,
  type JipsaPolicy,
} from "@jipsa/delegation";
import { ABI } from "@jipsa/delegation";
import { optionalAddress, optionalString, requirePrivateKey } from "../src/env.js";

/** 지시서 작업 2의 고정 데모 정책 */
const DEMO_POLICY = {
  totalBudget: tkrw(5_000),
  perTxCap: tkrw(50),
  dailyCap: tkrw(500),
  validDays: 7,
  verifiedRecipientOnly: true,
} as const;

const rpcUrl = optionalString("RPC_URL") ?? FLASHBLOCKS_RPC_URL;
// 기본 출력은 앱 루트 고정 — `pnpm -F` 로 실행하면 CWD가 apps/agent 가 되어
// CWD 기준 상대경로를 쓰면 경로가 중복된다.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outOverride = optionalString("OUT");
const outPath = outOverride ? resolve(outOverride) : resolve(appRoot, "delegation.json");

const chain = {
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;

async function main() {
  const ownerKey = requirePrivateKey("OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount(ownerKey);
  const agent: Address = optionalAddress("AGENT_ADDRESS") ?? DEMO.agent;
  const owner = account.address;

  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  console.log("위임 발급");
  console.log("  RPC        :", rpcUrl);
  console.log("  주인 EOA   :", owner);
  console.log("  에이전트   :", agent);

  // ---- 발급 전 온체인 전제 확인 ----
  // 여기서 막지 않으면 리딤 시점에 애매한 revert가 나 원인 파악이 어려워진다.
  await assertOwnerIsDelegationAccount(client, owner);
  await assertOwnerHasStamp(client, owner);
  await assertAgentBoundToOwner(client, agent, owner);

  // ---- 정책 → caveat ----
  // startDate는 체인 시각을 쓴다. 로컬 벽시계가 앞서면 기간 enforcer가
  // transfer-not-started로 첫 리딤을 막는다.
  const startDate = await startDateFromChain(client);
  const validUntil = Number(startDate) + DEMO_POLICY.validDays * 86_400;

  const policy: JipsaPolicy = {
    totalBudget: DEMO_POLICY.totalBudget,
    perTxCap: DEMO_POLICY.perTxCap,
    dailyCap: DEMO_POLICY.dailyCap,
    validUntil,
    verifiedRecipientOnly: DEMO_POLICY.verifiedRecipientOnly,
    agent,
  };

  const unsigned: Delegation = {
    delegate: agent,
    delegator: owner,
    authority: ROOT_AUTHORITY,
    caveats: buildCaveats(policy, startDate),
    // 같은 정책을 다시 발급해도 해시가 겹치지 않게 한다
    salt: BigInt(Date.now()),
    signature: "0x",
  };

  const typedData = delegationTypedData(unsigned);
  const signature = await account.signTypedData(typedData);
  const delegation: Delegation = { ...unsigned, signature };

  // ---- 발급 후 즉시 검증 (지시서 작업 2 요구사항) ----
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`서명자 불일치: 복원된 주소 ${recovered} != 주인 ${owner}`);
  }
  if (delegation.delegator.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`delegator 불일치: ${delegation.delegator} != ${owner}`);
  }

  const hash = getDelegationHash(delegation);
  const json = delegationToJson(delegation, {
    chainId: CHAIN_ID,
    delegationManager: ADDR.delegationManager,
    delegationHash: hash,
    policy: {
      totalBudget: policy.totalBudget.toString(),
      perTxCap: policy.perTxCap.toString(),
      dailyCap: policy.dailyCap.toString(),
      validUntil: policy.validUntil,
      verifiedRecipientOnly: policy.verifiedRecipientOnly,
    },
    createdAt: new Date(Number(startDate) * 1000).toISOString(),
  });
  writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);

  console.log("");
  console.log("  정책       : 총예산 5,000 · 건당 50 · 일간 500 tKRW · 7일 · 검증수신처 ON");
  console.log("  caveat     :", delegation.caveats.length, "개 (확정 순서)");
  console.log("  위임 해시  :", hash);
  console.log("  서명자 확인: OK (복원된 주소 == 주인 EOA)");
  console.log("  저장        :", outPath);
}

async function assertOwnerIsDelegationAccount(
  client: { getCode: (a: { address: Address }) => Promise<`0x${string}` | undefined> },
  owner: Address,
) {
  const code = await client.getCode({ address: owner });
  const expected = `0xef0100${ADDR.delegator7702Impl.slice(2)}`.toLowerCase();
  if ((code ?? "0x").toLowerCase() !== expected) {
    throw new Error(
      `주인 EOA에 EIP-7702 코드가 없습니다 (위임 계정이 아님).\n` +
        `  현재 code: ${code ?? "0x"}\n` +
        `  기대값   : ${expected}\n` +
        `  셋업: cast send ${owner} --auth ${ADDR.delegator7702Impl} --private-key $OWNER_PRIVATE_KEY --rpc-url ${rpcUrl}\n` +
        `  ⚠️ cast send 직후 code가 0x로 보일 수 있다 — 한 블록 뒤 cast code로 재확인할 것.`,
    );
  }
}

async function assertOwnerHasStamp(
  client: ReturnType<typeof createPublicClient>,
  owner: Address,
) {
  const verified = await client.readContract({
    address: ADDR.dojangGate,
    abi: ABI.dojangVerifiedGate,
    functionName: "isVerified",
    args: [owner],
  });
  if (!verified) {
    throw new Error(
      `주인 EOA에 Dojang 도장이 없습니다. DojangCaveatEnforcer의 주인 검사에서 막힙니다.\n` +
        `  플레이그라운드에서 TESTNET FAUCET attester로 발급하세요.`,
    );
  }
}

async function assertAgentBoundToOwner(
  client: ReturnType<typeof createPublicClient>,
  agent: Address,
  owner: Address,
) {
  const boundOwner = (await client.readContract({
    address: ADDR.bindingRegistry,
    abi: ABI.ownerBindingRegistry,
    functionName: "ownerOf",
    args: [agent],
  })) as Address;

  if (boundOwner.toLowerCase() !== owner.toLowerCase()) {
    const pending = (await client.readContract({
      address: ADDR.bindingRegistry,
      abi: ABI.ownerBindingRegistry,
      functionName: "pendingOwnerOf",
      args: [agent],
    })) as Address;
    throw new Error(
      `에이전트가 이 주인에게 바인딩되지 않았습니다 — DojangCaveatEnforcer가 리딤을 막습니다.\n` +
        `  ownerOf(agent)        : ${boundOwner}\n` +
        `  pendingOwnerOf(agent) : ${pending}\n` +
        `  주인:  proposeBinding(${agent})\n` +
        `  에이전트: cast send ${ADDR.bindingRegistry} "acceptBinding(address)" ${owner} --private-key $AGENT_PRIVATE_KEY --rpc-url ${rpcUrl}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error("");
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
