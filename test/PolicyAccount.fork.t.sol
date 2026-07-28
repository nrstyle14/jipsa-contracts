// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ForkTestBase} from "./ForkTestBase.sol";
import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";
import {PolicyAccount} from "../src/PolicyAccount.sol";

/// @notice GIWA Sepolia 포크 통합 테스트 — MockVerifiedGate 없이
///         실제 Dojang 도장으로 바인딩·지출 전체 흐름을 검증한다.
///         정책 산술(상한/일간 윈도우)은 PolicyAccount.t.sol에서 다루고,
///         여기서는 실제 게이트에 의존하는 경로만 확인한다.
/// 실행:
///   forge test --match-path test/PolicyAccount.fork.t.sol \
///     --fork-url https://sepolia-rpc.giwa.io
contract PolicyAccountForkTest is ForkTestBase {
    JipsaSettlementToken token;
    DojangVerifiedGate gate;
    OwnerBindingRegistry registry;

    /// @dev 실제 Dojang 도장을 보유한 주소만 주인이 될 수 있다
    address owner = VERIFIED_SUBJECT;
    address agent = makeAddr("agent");
    address merchant = makeAddr("merchant");

    uint256 constant FUNDING = 100_000e6;
    uint256 constant PER_TX_CAP = 1_000e6;

    /// @dev 게이트·레지스트리 배포 후 주인↔에이전트 바인딩까지 마친 정책 지갑 생성.
    ///      포크에서만 호출된다 (chainid 가드 통과 후).
    function _bindAndFund(bool verifiedRecipientOnly) internal returns (PolicyAccount) {
        token = new JipsaSettlementToken();
        gate = _deployGate();
        registry = new OwnerBindingRegistry(gate);

        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(owner);

        PolicyAccount.Policy memory p = PolicyAccount.Policy({
            totalBudget: FUNDING,
            perTxCap: PER_TX_CAP,
            dailyCap: 10_000e6,
            validUntil: uint64(block.timestamp + 7 days),
            verifiedRecipientOnly: verifiedRecipientOnly
        });
        PolicyAccount acct = new PolicyAccount(owner, agent, registry, gate, token, p);
        token.mint(address(acct), FUNDING);
        return acct;
    }

    /// @notice 실제 도장 보유자가 주인이 되어 바인딩하고, 에이전트가 정책 내에서 지출한다.
    function test_Fork_RealVerifiedOwnerBindsAndAgentSpends() public {
        if (!_onGiwaFork()) return;

        PolicyAccount account = _bindAndFund(false);

        assertEq(registry.ownerOf(agent), owner, "agent should be bound to the verified owner");
        assertTrue(registry.isAccountableAgent(agent), "agent should be accountable via the real gate");

        vm.prank(agent);
        account.pay(merchant, PER_TX_CAP);

        assertEq(token.balanceOf(merchant), PER_TX_CAP, "merchant should receive the payment");
        assertEq(account.spentTotal(), PER_TX_CAP, "spend should be recorded");
    }

    /// @notice 도장이 없는 주소는 실제 게이트에서 주인으로 등록되지 않는다.
    function test_Fork_RevertWhen_UnverifiedOwnerProposesBinding() public {
        if (!_onGiwaFork()) return;

        gate = _deployGate();
        registry = new OwnerBindingRegistry(gate);

        vm.prank(UNVERIFIED_SUBJECT);
        vm.expectRevert(
            abi.encodeWithSelector(OwnerBindingRegistry.OwnerNotVerified.selector, UNVERIFIED_SUBJECT)
        );
        registry.proposeBinding(agent);
    }

    /// @notice verifiedRecipientOnly 정책이 실제 게이트로 수신처를 판정한다.
    ///         (프롬프트 인젝션으로 임의 주소에 송금하려는 시도 차단)
    function test_Fork_VerifiedRecipientOnlyUsesRealGate() public {
        if (!_onGiwaFork()) return;

        PolicyAccount account = _bindAndFund(true);

        // 도장 없는 수신처 → 차단
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyAccount.RecipientNotVerified.selector, merchant));
        account.pay(merchant, PER_TX_CAP);

        // 실제 도장 보유 수신처 → 허용
        uint256 before = token.balanceOf(VERIFIED_SUBJECT);
        vm.prank(agent);
        account.pay(VERIFIED_SUBJECT, PER_TX_CAP);

        assertEq(
            token.balanceOf(VERIFIED_SUBJECT), before + PER_TX_CAP, "verified recipient should receive the payment"
        );
        assertEq(account.spentTotal(), PER_TX_CAP, "only the allowed spend should be recorded");
    }
}
