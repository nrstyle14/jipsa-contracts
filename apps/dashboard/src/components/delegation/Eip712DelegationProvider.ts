import {
  ADDR,
  buildCaveats,
  delegationTypedData,
  startDateFromChain,
  ROOT_AUTHORITY,
  type Delegation,
  type JipsaPolicy,
} from "@jipsa/delegation";
import type { Address, Hash, PublicClient, WalletClient } from "viem";
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

    const signature = await this.walletClient.signTypedData({
      account,
      ...delegationTypedData(unsigned),
    });
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
