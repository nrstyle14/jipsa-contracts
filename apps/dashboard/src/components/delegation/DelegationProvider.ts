import type { Address, Hash } from "viem";
import type { Delegation, JipsaPolicy } from "@jipsa/delegation";

/**
 * 위임을 얻어오는 경로를 인터페이스로 추상화한다 (설계서 §10).
 *
 * 등록 마법사는 **이 인터페이스만 바라본다** — ERC-7715가 GIWA에서 열리면
 * provider 주입만 교체하고 마법사 코드는 건드리지 않는다.
 */
export interface DelegationProvider {
  /** 이 계정이 위임 발급 가능한 상태인가 (7702 코드 보유 여부) */
  isReady(account: Address): Promise<boolean>;
  /** 정책 조건으로 서명된 위임을 발급받는다 */
  grantDelegation(policy: JipsaPolicy): Promise<Delegation>;
  /** 위임 철회 */
  revokeDelegation(d: Delegation): Promise<Hash>;
}
