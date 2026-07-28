import { ADDR } from "@jipsa/delegation";
import type { Address, Hash, PublicClient } from "viem";
import type { Delegation, JipsaPolicy } from "@jipsa/delegation";
import type { DelegationProvider } from "./DelegationProvider.js";

/**
 * 현재 MVP에 탑재되는 구현 (설계서 §10 구현 1).
 *
 * M1에서는 게이팅에 필요한 `isReady`만 구현한다.
 * `grantDelegation`(EIP-712 서명)·`revokeDelegation`(disableDelegation)은 M2에서 채운다.
 */
export class Eip712DelegationProvider implements DelegationProvider {
  constructor(private readonly client: PublicClient) {}

  /**
   * `eth_getCode(account)`가 `0xef0100 + StatelessDeleGator주소` 인지 확인한다.
   * 접두사만 보면 다른 구현체를 가리키는 계정을 통과시키므로 전체를 비교한다.
   */
  async isReady(account: Address): Promise<boolean> {
    const code = await this.client.getCode({ address: account });
    const expected = `0xef0100${ADDR.delegator7702Impl.slice(2)}`.toLowerCase();
    return (code ?? "0x").toLowerCase() === expected;
  }

  grantDelegation(_policy: JipsaPolicy): Promise<Delegation> {
    throw new Error("M2에서 구현 — signTypedData로 EIP-712 서명");
  }

  revokeDelegation(_d: Delegation): Promise<Hash> {
    throw new Error("M2에서 구현 — DelegationManager.disableDelegation");
  }
}
