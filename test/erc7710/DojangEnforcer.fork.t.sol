// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ForkTestBase} from "../ForkTestBase.sol";
import {ModeLib} from "@erc7579/lib/ModeLib.sol";
import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";

import {JipsaSettlementToken} from "../../src/JipsaSettlementToken.sol";
import {DojangVerifiedGate} from "../../src/gates/DojangVerifiedGate.sol";
import {OwnerBindingRegistry} from "../../src/OwnerBindingRegistry.sol";
import {DojangCaveatEnforcer} from "../../src/enforcers/DojangCaveatEnforcer.sol";

/// @notice DojangCaveatEnforcer를 **실제 DojangScroll 상태**에 대고 검증한다.
///
/// @dev 여기서 확인하려는 것은 enforcer가 mock이 아닌 실제 게이트에 제대로
///      물려 있는지다. 검사 순서(수신처 도장 → 바인딩 → 주인 도장)를 이용해
///      실제 도장 유무가 결과를 가르는지를 키 없이 확인한다.
///
///      ⚠️ 정상 리딤까지 도는 전체 사이클은 **도장을 보유한 데모 주인 EOA의 키**가
///      필요하다(위임 EIP-712 서명 + type-4 authorization). 현재 도장 보유 주소는
///      키가 없어 여기서 다루지 않는다. 전용 데모 EOA에 TESTNET FAUCET 도장을
///      발급받은 뒤 DelegationRedeem.t.sol의 시나리오를 포크에서 재현하면 된다.
///      서명 검증 자체(ERC-1271 경로)는 DelegationRedeem.t.sol에서 실키로 커버된다.
contract DojangEnforcerForkTest is ForkTestBase {
    JipsaSettlementToken token;
    DojangVerifiedGate gate;
    OwnerBindingRegistry registry;
    DojangCaveatEnforcer enforcer;

    address unstampedOwner = makeAddr("unstampedOwner");
    address agent = makeAddr("agent");

    uint256 constant AMOUNT = 1_000e6;

    function _setUpStack() internal {
        token = new JipsaSettlementToken();
        gate = _deployGate();
        registry = new OwnerBindingRegistry(gate);
        enforcer = new DojangCaveatEnforcer();
    }

    function _terms(bool verifiedRecipientOnly) internal view returns (bytes memory) {
        return abi.encode(address(gate), address(registry), address(token), verifiedRecipientOnly);
    }

    function _execution(address to) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(token), 0, abi.encodeWithSelector(token.transfer.selector, to, AMOUNT)
        );
    }

    /// @dev enforcer를 직접 호출한다. DelegationManager를 거치지 않아도
    ///      beforeHook의 판정 로직은 동일하다.
    function _beforeHook(bytes memory terms_, address to, address delegator, address redeemer) internal view {
        enforcer.beforeHook(
            terms_, hex"", ModeLib.encodeSimpleSingle(), _execution(to), bytes32(0), delegator, redeemer
        );
    }

    /// @notice 실제 게이트에서 도장 없는 수신처는 막히고, 도장 보유 수신처는
    ///         수신처 검사를 통과해 다음 단계(바인딩)까지 진행한다.
    ///         두 결과가 갈린다는 것이 곧 실제 온체인 도장을 읽고 있다는 증거다.
    function test_Fork_RecipientStampDecidesOutcome() public {
        if (!_onGiwaFork()) return;
        _setUpStack();

        // 도장 없는 수신처 → 수신처 검사에서 막힌다
        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.RecipientNotVerified.selector, UNVERIFIED_SUBJECT)
        );
        _beforeHook(_terms(true), UNVERIFIED_SUBJECT, unstampedOwner, agent);

        // 실제 도장 보유 수신처 → 수신처 검사를 통과하고 바인딩 검사에서 막힌다
        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.AgentNotBound.selector, agent, unstampedOwner)
        );
        _beforeHook(_terms(true), VERIFIED_SUBJECT, unstampedOwner, agent);
    }

    /// @notice 바인딩을 맞춰도 주인에게 실제 도장이 없으면 막힌다.
    ///         (주인 도장 검사가 실제 게이트를 조회한다는 증거)
    function test_Fork_RevertWhen_OwnerHasNoRealStamp() public {
        if (!_onGiwaFork()) return;
        _setUpStack();

        // 레지스트리는 게이트를 통과해야 바인딩되므로, 도장 없는 주인은
        // 애초에 제안 자체가 막힌다 — 이것부터 실제 게이트로 확인한다
        vm.prank(unstampedOwner);
        vm.expectRevert(
            abi.encodeWithSelector(OwnerBindingRegistry.OwnerNotVerified.selector, unstampedOwner)
        );
        registry.proposeBinding(agent);

        // 바인딩이 없으므로 enforcer도 바인딩 불일치로 막는다
        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.AgentNotBound.selector, agent, unstampedOwner)
        );
        _beforeHook(_terms(false), UNVERIFIED_SUBJECT, unstampedOwner, agent);
    }

    /// @notice 실제 도장 보유 주소는 주인으로 바인딩까지 성립한다.
    ///         (여기까지가 키 없이 검증 가능한 한계 — 리딤은 서명이 필요하다)
    function test_Fork_StampedOwnerCanBindAndPassEnforcer() public {
        if (!_onGiwaFork()) return;
        _setUpStack();

        // 실제 도장 보유 주소를 주인으로 바인딩 (prank이므로 키 불필요)
        vm.prank(VERIFIED_SUBJECT);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(VERIFIED_SUBJECT);
        assertEq(registry.ownerOf(agent), VERIFIED_SUBJECT);

        // 실제 게이트 기준으로 세 검사를 모두 통과한다 (revert 없음)
        _beforeHook(_terms(true), VERIFIED_SUBJECT, VERIFIED_SUBJECT, agent);

        // 다른 에이전트는 바인딩 불일치로 막힌다
        address stranger = makeAddr("strangerAgent");
        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.AgentNotBound.selector, stranger, VERIFIED_SUBJECT)
        );
        _beforeHook(_terms(true), VERIFIED_SUBJECT, VERIFIED_SUBJECT, stranger);
    }
}
