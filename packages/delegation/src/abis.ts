import type { Abi } from "viem";
import delegationManager from "../abi/DelegationManager.json" with { type: "json" };
import dojangCaveatEnforcer from "../abi/DojangCaveatEnforcer.json" with { type: "json" };
import dojangVerifiedGate from "../abi/DojangVerifiedGate.json" with { type: "json" };
import erc20PeriodTransferEnforcer from "../abi/ERC20PeriodTransferEnforcer.json" with { type: "json" };
import erc20TransferAmountEnforcer from "../abi/ERC20TransferAmountEnforcer.json" with { type: "json" };
import jipsaPerTxCapEnforcer from "../abi/JipsaPerTxCapEnforcer.json" with { type: "json" };
import jipsaSettlementToken from "../abi/JipsaSettlementToken.json" with { type: "json" };
import ownerBindingRegistry from "../abi/OwnerBindingRegistry.json" with { type: "json" };

/**
 * `forge inspect <컨트랙트> abi` 로 생성한 ABI.
 *
 * 재생성 (컨트랙트 인터페이스가 바뀌었을 때):
 *   forge inspect OwnerBindingRegistry abi --json > packages/delegation/abi/OwnerBindingRegistry.json
 */
export const ABI = {
  delegationManager: delegationManager as Abi,
  dojangCaveatEnforcer: dojangCaveatEnforcer as Abi,
  dojangVerifiedGate: dojangVerifiedGate as Abi,
  erc20PeriodTransferEnforcer: erc20PeriodTransferEnforcer as Abi,
  erc20TransferAmountEnforcer: erc20TransferAmountEnforcer as Abi,
  jipsaPerTxCapEnforcer: jipsaPerTxCapEnforcer as Abi,
  tKRW: jipsaSettlementToken as Abi,
  ownerBindingRegistry: ownerBindingRegistry as Abi,
} as const;
