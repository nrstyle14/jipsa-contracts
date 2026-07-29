import { encodeFunctionData, type Address, type Hex } from "viem";
import { ABI, ADDR, encodeRedeem, type Delegation } from "@jipsa/delegation";

/**
 * `redeemDelegations` calldata — 결제 1건.
 *
 * agent.ts · pay.ts · trigger-block.ts가 같은 인코딩을 써야 한다. 세 곳에 복사해두면
 * 한 곳만 고치는 사고가 난다.
 */
export function redeemCalldata(d: Delegation, to: Address, amount: bigint): Hex {
  const call = encodeRedeem(d, to, amount);
  return encodeFunctionData({
    abi: ABI.delegationManager,
    functionName: "redeemDelegations",
    args: [call.permissionContexts, call.modes, call.executionCallDatas],
  });
}

export const DELEGATION_MANAGER = ADDR.delegationManager;
