import { beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, CHAIN_ID, DEMO, tkrw } from "../src/addresses.js";
import { buildCaveats, startDateFromChain } from "../src/caveats.js";
import {
  delegationTypedData,
  getDelegationHash,
  ROOT_AUTHORITY,
  type Delegation,
  type JipsaPolicy,
} from "../src/delegation.js";
import { encodeRedeem } from "../src/redeem.js";
import delegationManagerAbiJson from "../abi/DelegationManager.json" with { type: "json" };
import tokenAbiJson from "../abi/JipsaSettlementToken.json" with { type: "json" };
import registryAbiJson from "../abi/OwnerBindingRegistry.json" with { type: "json" };

const delegationManagerAbi = delegationManagerAbiJson as Abi;
const tokenAbi = tokenAbiJson as Abi;
const registryAbi = registryAbiJson as Abi;

/**
 * 서명 → 리딤 왕복을 **실제 컨트랙트에 대고** 검증한다.
 *
 * 전제: GIWA Sepolia를 포크한 anvil이 ANVIL_RPC_URL에서 돌고 있어야 한다.
 *   anvil --fork-url https://sepolia-rpc-flashblocks.giwa.io --port 8545
 *
 * 주인 키가 필요하다 (OWNER_PRIVATE_KEY). 둘 중 하나라도 없으면 skip한다 —
 * CI나 키 없는 환경에서 실패하지 않게 한다.
 */
const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const OWNER_PK = process.env.OWNER_PRIVATE_KEY as Hex | undefined;

const chain = {
  id: CHAIN_ID,
  name: "GIWA Sepolia (fork)",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const;

async function anvilReady(): Promise<boolean> {
  try {
    const c = createPublicClient({ chain, transport: http(ANVIL_RPC) });
    return (await c.getChainId()) === CHAIN_ID;
  } catch {
    return false;
  }
}

const ready = Boolean(OWNER_PK) && (await anvilReady());

describe.skipIf(!ready)("서명 → 리딤 왕복 (anvil 포크)", { timeout: 60_000 }, () => {
  // ⚠️ describe.skipIf 는 콜백 본문을 여전히 평가한다. 키가 없으면
  //    privateKeyToAccount 가 수집 단계에서 throw 하므로 beforeAll 로 미룬다.
  let account: ReturnType<typeof privateKeyToAccount>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let wallet: ReturnType<typeof createWalletClient>;

  beforeAll(() => {
    account = privateKeyToAccount(OWNER_PK!);
    publicClient = createPublicClient({ chain, transport: http(ANVIL_RPC) });
    wallet = createWalletClient({ account, chain, transport: http(ANVIL_RPC) });
  });

  const policy: JipsaPolicy = {
    totalBudget: tkrw(5_000),
    perTxCap: tkrw(50),
    dailyCap: tkrw(500),
    validUntil: Math.floor(Date.now() / 1000) + 7 * 86_400,
    verifiedRecipientOnly: true,
    agent: DEMO.agent,
  };

  async function signedDelegation(salt: bigint): Promise<Delegation> {
    // 체인 시각을 startDate로 쓴다 — 로컬 벽시계는 포크보다 앞서 있어
    // 기간 enforcer가 transfer-not-started로 막는다
    const startDate = await startDateFromChain(publicClient);
    const unsigned: Delegation = {
      delegate: policy.agent,
      delegator: DEMO.owner,
      authority: ROOT_AUTHORITY,
      caveats: buildCaveats(policy, startDate),
      salt,
      signature: "0x",
    };
    const signature = await wallet.signTypedData({ account, ...delegationTypedData(unsigned) });
    return { ...unsigned, signature };
  }

  /** anvil에서 에이전트 주소로 임의 tx를 보낼 수 있게 impersonate */
  async function impersonate(addr: Address) {
    await publicClient.request({
      method: "anvil_impersonateAccount" as never,
      params: [addr] as never,
    });
    await publicClient.request({
      method: "anvil_setBalance" as never,
      params: [addr, "0xDE0B6B3A7640000"] as never,
    });
  }

  it("서명자가 주인 EOA와 일치한다", () => {
    expect(account.address.toLowerCase()).toBe(DEMO.owner.toLowerCase());
  });

  it("바인딩 상태가 온체인에서 확인된다", async () => {
    const owner = await publicClient.readContract({
      address: ADDR.bindingRegistry,
      abi: registryAbi  ,
      functionName: "ownerOf",
      args: [DEMO.agent],
    });
    expect((owner as string).toLowerCase()).toBe(DEMO.owner.toLowerCase());
  });

  it("도장 보유 가맹처로 리딤이 성공하고 tKRW가 이동한다", async () => {
    const d = await signedDelegation(1001n);
    const amount = tkrw(2);

    const before = (await publicClient.readContract({
      address: ADDR.tKRW,
      abi: tokenAbi  ,
      functionName: "balanceOf",
      args: [DEMO.merchantA],
    })) as bigint;

    await impersonate(DEMO.agent);
    const call = encodeRedeem(d, DEMO.merchantA, amount);
    const hash = await publicClient.request({
      method: "eth_sendTransaction" as never,
      params: [
        {
          from: DEMO.agent,
          to: ADDR.delegationManager,
          data: encodeRedeemData(call),
        },
      ] as never,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
    expect(receipt.status).toBe("success");

    const after = (await publicClient.readContract({
      address: ADDR.tKRW,
      abi: tokenAbi  ,
      functionName: "balanceOf",
      args: [DEMO.merchantA],
    })) as bigint;
    expect(after - before).toBe(amount);
  });

  it("건당 상한 초과는 PerTxCapExceeded로 막힌다", async () => {
    const d = await signedDelegation(1002n);
    await impersonate(DEMO.agent);
    const call = encodeRedeem(d, DEMO.merchantA, policy.perTxCap + 1n);

    // viem이 enforcer ABI를 모르므로 이름 대신 셀렉터로 확인한다.
    // 0xc154b3a8 = PerTxCapExceeded(uint256,uint256)  (cast sig 로 확인)
    const PER_TX_CAP_EXCEEDED_SELECTOR = "0xc154b3a8";
    await expect(
      publicClient.call({
        account: DEMO.agent,
        to: ADDR.delegationManager,
        data: encodeRedeemData(call),
      }),
    ).rejects.toThrow(PER_TX_CAP_EXCEEDED_SELECTOR);
  });

  it("위임 해시가 온체인 disabledDelegations 조회 키로 쓰인다", async () => {
    const d = await signedDelegation(1003n);
    const disabled = await publicClient.readContract({
      address: ADDR.delegationManager,
      abi: delegationManagerAbi  ,
      functionName: "disabledDelegations",
      args: [getDelegationHash(d)],
    });
    expect(disabled).toBe(false);
  });
});

/** `redeemDelegations(bytes[],bytes32[],bytes[])` 호출 데이터 */
function encodeRedeemData(call: ReturnType<typeof encodeRedeem>): Hex {
  return encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: "redeemDelegations",
    args: [call.permissionContexts, call.modes, call.executionCallDatas],
  });
}
