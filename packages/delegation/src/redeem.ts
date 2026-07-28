import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { ADDR } from "./addresses.js";
import { MODE_SIMPLE_SINGLE, type Delegation } from "./delegation.js";

/**
 * `ExecutionLib.encodeSingle` 과 동일한 인코딩.
 *
 * 출처: lib/delegation-framework/lib/erc7579-implementation/src/lib/ExecutionLib.sol
 *   `decodeSingle`: target = [0:20], value = [20:52], callData = [52:]
 * → `abi.encodePacked(target, value, callData)`
 */
export function encodeSingleExecution(target: Address, value: bigint, callData: Hex): Hex {
  return encodePacked(["address", "uint256", "bytes"], [target, value, callData]);
}

/** tKRW `transfer(to, amount)` 실행 데이터 */
export function encodeTokenTransferExecution(
  to: Address,
  amount: bigint,
  token: Address = ADDR.tKRW,
): Hex {
  const callData = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "transfer",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
        stateMutability: "nonpayable",
      },
    ],
    functionName: "transfer",
    args: [to, amount],
  });
  return encodeSingleExecution(token, 0n, callData);
}

/**
 * `Delegation[]`을 `permissionContexts` 원소로 인코딩한다.
 *
 * `DelegationManager.redeemDelegations`는 각 원소를 `abi.decode(_, (Delegation[]))`로
 * 푼다. 따라서 튜플 배열로 abi.encode 해야 한다 (packed 아님).
 * 필드 순서는 src/utils/Types.sol `struct Delegation` 과 일치해야 한다.
 */
export function encodePermissionContext(delegations: readonly Delegation[]): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      "(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature)[]",
    ),
    [
      delegations.map((d) => ({
        delegate: d.delegate,
        delegator: d.delegator,
        authority: d.authority,
        caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args })),
        salt: d.salt,
        signature: d.signature,
      })),
    ] as never,
  );
}

export interface RedeemCall {
  permissionContexts: Hex[];
  modes: Hex[];
  executionCallDatas: Hex[];
}

/**
 * 단건 tKRW 결제 리딤 인자를 만든다.
 *
 * 에이전트가 `DelegationManager.redeemDelegations(...)`에 그대로 넘긴다 —
 * **일반 트랜잭션이며 번들러·EntryPoint가 필요 없다.**
 *
 * ⚠️ 모드는 single 고정이다. 우리 caveat은 Timestamp를 제외하면 전부
 *    `onlySingleCallTypeMode`이므로 batch로 보내면 전부 revert한다.
 */
export function encodeRedeem(delegation: Delegation, to: Address, amount: bigint): RedeemCall {
  return {
    permissionContexts: [encodePermissionContext([delegation])],
    modes: [MODE_SIMPLE_SINGLE],
    executionCallDatas: [encodeTokenTransferExecution(to, amount)],
  };
}

/**
 * 여러 결제를 한 트랜잭션에 담는다 (각각 독립적인 single 실행).
 *
 * ⚠️ 이것은 batch **모드**가 아니다. 배열 원소마다 single 모드 실행이 하나씩 들어가는
 *    형태이며, 그래서 우리 caveat이 그대로 적용된다. 다만 건당 상한은 원소별로
 *    평가되므로 **누적 상한이 없으면 이 경로로 잔액이 빠질 수 있다**
 *    (test/erc7710/CumulativeDrain.t.sol).
 */
export function encodeRedeemMany(
  delegation: Delegation,
  payments: readonly { to: Address; amount: bigint }[],
): RedeemCall {
  const context = encodePermissionContext([delegation]);
  return {
    permissionContexts: payments.map(() => context),
    modes: payments.map(() => MODE_SIMPLE_SINGLE),
    executionCallDatas: payments.map((p) => encodeTokenTransferExecution(p.to, p.amount)),
  };
}
