import {
  ADDR,
  buildCaveats,
  delegationTypedData,
  startDateFromChain,
  ROOT_AUTHORITY,
  type Delegation,
  type JipsaPolicy,
} from "@jipsa/delegation";
import type { Address, Hash, Hex, PublicClient, WalletClient } from "viem";
import type { DelegationProvider } from "./DelegationProvider.js";
import { ABI } from "@jipsa/delegation";

/**
 * 현재 MVP에 탑재되는 구현 (설계서 §10 구현 1).
 *
 * 위임 발급은 **온체인 트랜잭션이 아니다** — EIP-712 서명만 받는다.
 * 철회는 주인 EOA가 delegator이므로 일반 tx로 `disableDelegation`을 부른다.
 */
export class Eip712DelegationProvider implements DelegationProvider {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
  ) {}

  /**
   * `eth_getCode(account)`가 `0xef0100 + StatelessDeleGator주소` 인지 확인한다.
   * 접두사만 보면 다른 구현체를 가리키는 계정을 통과시키므로 전체를 비교한다.
   */
  async isReady(account: Address): Promise<boolean> {
    const code = await this.publicClient.getCode({ address: account });
    const expected = `0xef0100${ADDR.delegator7702Impl.slice(2)}`.toLowerCase();
    return (code ?? "0x").toLowerCase() === expected;
  }

  async grantDelegation(policy: JipsaPolicy): Promise<Delegation> {
    const account = this.walletClient.account;
    if (!account) throw new Error("지갑이 연결되지 않았습니다");

    if (!(await this.isReady(account.address))) {
      throw new Error(
        "이 지갑은 아직 위임 계정이 아닙니다 (EIP-7702 코드 없음). CLI로 셋업한 뒤 다시 시도하세요.",
      );
    }

    // startDate는 체인 시각을 쓴다. 로컬 벽시계가 앞서면 기간 enforcer가
    // transfer-not-started 로 첫 리딤을 막는다.
    const startDate = await startDateFromChain(this.publicClient);

    const unsigned: Delegation = {
      delegate: policy.agent,
      delegator: account.address,
      authority: ROOT_AUTHORITY,
      caveats: buildCaveats(policy, startDate),
      // 같은 정책을 다시 발급해도 해시가 겹치지 않게 한다
      salt: BigInt(Date.now()),
      signature: "0x",
    };

    let signature: Hex;
    try {
      signature = await this.walletClient.signTypedData({
        account,
        ...delegationTypedData(unsigned),
      });
    } catch (e) {
      throw new Error(explainSignFailure(e));
    }
    return { ...unsigned, signature };
  }

  async revokeDelegation(d: Delegation): Promise<Hash> {
    const account = this.walletClient.account;
    if (!account) throw new Error("지갑이 연결되지 않았습니다");
    return this.walletClient.writeContract({
      account,
      chain: this.walletClient.chain,
      address: ADDR.delegationManager,
      abi: ABI.delegationManager,
      functionName: "disableDelegation",
      args: [
        {
          delegate: d.delegate,
          delegator: d.delegator,
          authority: d.authority,
          caveats: d.caveats,
          salt: d.salt,
          signature: d.signature,
        },
      ],
    });
  }
}

/**
 * 위임 서명 실패 해설.
 *
 * ⚠️ **MetaMask 는 dapp 의 위임 서명 요청을 의도적으로 차단한다.**
 *    `primaryType: "Delegation"` + 도메인 `DelegationManager` 조합을 알아보고
 *    "External signature requests cannot sign delegations for internal accounts"
 *    (code -32603) 로 거절한다. 자사 스마트 계정의 ERC-7715 `wallet_grantPermissions`
 *    흐름으로만 허용한다 — 위임 서명은 지출 권한을 넘기는 행위라 일반 서명 팝업으로
 *    아무 dapp 이나 받으면 위험하다는 판단이고, 타당하다.
 *
 *    그래서 이 경로는 MetaMask 로는 열리지 않는다. 대안은 두 가지다:
 *      · 이 가드가 없는 인젝티드 지갑으로 서명
 *      · 주인 키로 CLI 발급 (`pnpm -F @jipsa/agent grant`)
 *    raw RPC 오류를 그대로 보여주면 원인을 알 수 없으므로 여기서 설명으로 바꾼다.
 */
function explainSignFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (/cannot sign delegations for internal accounts/i.test(msg)) {
    return (
      "MetaMask 가 위임 서명 요청을 차단했습니다 — dapp 이 위임(Delegation) 서명을 받는 것을 " +
      "정책적으로 막고, 자사 스마트 계정의 ERC-7715 흐름만 허용합니다. " +
      "주인 키로 CLI 발급을 쓰거나(pnpm -F @jipsa/agent grant), 이 제약이 없는 지갑으로 서명하세요."
    );
  }
  if (/user rejected|denied|4001/i.test(msg)) {
    return "지갑에서 서명을 거절했습니다.";
  }
  return msg.split("\n")[0] ?? msg;
}
