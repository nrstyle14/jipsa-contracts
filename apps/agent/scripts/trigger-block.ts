/**
 * 정책 위반 리딤을 **실제로 브로드캐스트**해 대시보드의 "차단됨" 행을 만든다.
 *
 * 차단은 이벤트가 아니라 revert이므로, 실패한 트랜잭션이 온체인에 있어야
 * 피드가 receipt.status == 0 을 잡아 사유를 디코딩할 수 있다.
 *
 * 실행:
 *   set -a; source .env; set +a
 *   pnpm -F @jipsa/agent trigger-block            # 건당 초과 (PerTxCapExceeded)
 *   KIND=recipient pnpm -F @jipsa/agent trigger-block   # 미검증 수신처
 *
 * ⚠️ 실패 tx라 가스만 소모하고 자금은 움직이지 않는다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ABI,
  ADDR,
  CHAIN_ID,
  DEMO,
  FLASHBLOCKS_RPC_URL,
  delegationFromJson,
  encodeRedeem,
  tkrw,
} from "@jipsa/delegation";
import { optionalAddress, optionalString, requirePrivateKey } from "../src/env.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = optionalString("IN")
  ? resolve(optionalString("IN")!)
  : resolve(appRoot, "delegation.json");
const rpcUrl = optionalString("RPC_URL") ?? FLASHBLOCKS_RPC_URL;
const kind = (optionalString("KIND") ?? "pertx") as "pertx" | "recipient";
/** 도장 없는 주소 */
const attacker = optionalAddress("ATTACKER") ?? "0x000000000000000000000000000000000000dEaD";

const chain = {
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;

async function main() {
  const agentKey = requirePrivateKey("AGENT_PRIVATE_KEY");
  const account = privateKeyToAccount(agentKey);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const d = delegationFromJson(JSON.parse(readFileSync(inPath, "utf8")) as unknown);

  // 건당 초과: 51 tKRW (상한 50) → PerTxCapExceeded
  // 미검증 수신처: 2 tKRW를 도장 없는 주소로 → RecipientNotVerified
  const to: Address = kind === "recipient" ? attacker : DEMO.merchantA;
  const amount = kind === "recipient" ? tkrw(2) : tkrw(51);

  const call = encodeRedeem(d, to, amount);
  const data: Hex = encodeFunctionData({
    abi: ABI.delegationManager,
    functionName: "redeemDelegations",
    args: [call.permissionContexts, call.modes, call.executionCallDatas],
  });

  console.log("차단 유발 리딤 브로드캐스트");
  console.log("  종류    :", kind === "recipient" ? "미검증 수신처" : "건당 초과");
  console.log("  에이전트:", account.address);
  console.log("  수신처  :", to);
  console.log("  금액    :", amount.toString(), "(tKRW 최소단위)");

  // 가스 추정은 실패하므로 직접 지정한다 (eth_estimateGas가 revert를 그대로 되돌린다)
  const hash = await wallet.sendTransaction({
    to: ADDR.delegationManager,
    data,
    gas: 800_000n,
  });

  console.log("");
  console.log("  tx      :", hash);
  console.log("  → 대시보드 피드에 Pending → 차단됨 으로 나타나야 한다");
}

main().catch((e: unknown) => {
  console.error("");
  console.error("실패:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
