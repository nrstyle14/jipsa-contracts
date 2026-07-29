import type { Address, Hash } from "viem";
import type { Delegation, JipsaPolicy } from "@jipsa/delegation";
import type { DelegationProvider } from "./DelegationProvider.js";

/**
 * ERC-7715 경로 — **스텁만 두고 탑재하지 않는다** (설계서 §10 구현 2).
 *
 * 표준이 열리면 `grantDelegation`이 `wallet_grantPermissions` 호출 하나로 대체되고,
 * caveat 조립·계정 업그레이드·서명을 지갑이 처리한다. 마법사는 인터페이스만
 * 바라보므로 provider 주입만 교체하면 된다.
 *
 * 현재 MetaMask Flask 전용 + GIWA 미지원이라 구현하지 않는다.
 */
export class Erc7715DelegationProvider implements DelegationProvider {
  async isReady(_account: Address): Promise<boolean> {
    // TODO: wallet_getCapabilities 로 7715 지원 여부 조회
    return false;
  }

  grantDelegation(_policy: JipsaPolicy): Promise<Delegation> {
    // TODO: wallet_grantPermissions({ permissions: [...] })
    throw new Error("ERC-7715는 GIWA에서 아직 지원되지 않습니다");
  }

  revokeDelegation(_d: Delegation): Promise<Hash> {
    // TODO: wallet_revokePermissions 또는 disableDelegation 폴백
    throw new Error("ERC-7715는 GIWA에서 아직 지원되지 않습니다");
  }
}
