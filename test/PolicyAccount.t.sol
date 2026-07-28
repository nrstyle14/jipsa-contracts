// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";
import {MockVerifiedGate} from "../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";
import {PolicyAccount} from "../src/PolicyAccount.sol";

contract PolicyAccountTest is Test {
    JipsaSettlementToken token;
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    PolicyAccount account;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address merchant = makeAddr("merchant");
    address attacker = makeAddr("attacker");

    // 정책 단위는 tKRW 최소단위 (6 decimals)
    uint256 constant TOTAL_BUDGET = 100_000e6;
    uint256 constant PER_TX_CAP = 1_000e6;
    uint256 constant DAILY_CAP = 10_000e6;
    uint256 constant FUNDING = 100_000e6;

    function setUp() public {
        token = new JipsaSettlementToken();
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);

        // 주인 KYC 검증 처리 (데모: mock)
        gate.setVerified(owner, true);

        // 바인딩: 주인 제안 → 에이전트 수락
        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(owner);

        account = new PolicyAccount(owner, agent, registry, gate, token, _policy(TOTAL_BUDGET, false));

        // 자금 투입: 주인이 tKRW를 계정 주소로 직접 transfer (approve 없음)
        token.mint(owner, FUNDING);
        vm.prank(owner);
        assertTrue(token.transfer(address(account), FUNDING));
        assertEq(account.tokenBalance(), FUNDING);
    }

    function _policy(uint256 totalBudget, bool verifiedRecipientOnly)
        internal
        view
        returns (PolicyAccount.Policy memory)
    {
        return PolicyAccount.Policy({
            totalBudget: totalBudget,
            perTxCap: PER_TX_CAP,
            dailyCap: DAILY_CAP,
            validUntil: uint64(block.timestamp + 7 days),
            verifiedRecipientOnly: verifiedRecipientOnly
        });
    }

    // ---------- 지출 정책 ----------

    function test_AgentCanPayWithinPolicy() public {
        vm.prank(agent);
        account.pay(merchant, 500e6);

        assertEq(token.balanceOf(merchant), 500e6);
        assertEq(account.spentTotal(), 500e6);
        assertEq(account.tokenBalance(), FUNDING - 500e6);
    }

    function test_RevertWhen_PerTxCapExceeded() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyAccount.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP)
        );
        account.pay(merchant, PER_TX_CAP + 1);
    }

    function test_RevertWhen_DailyCapExceeded() public {
        vm.startPrank(agent);
        for (uint256 i = 0; i < 10; i++) {
            account.pay(merchant, PER_TX_CAP); // 10 × 1,000 = 10,000 = dailyCap
        }
        vm.expectRevert(
            abi.encodeWithSelector(PolicyAccount.DailyCapExceeded.selector, DAILY_CAP + PER_TX_CAP, DAILY_CAP)
        );
        account.pay(merchant, PER_TX_CAP);
        vm.stopPrank();
    }

    function test_RevertWhen_TotalBudgetExceeded() public {
        // 총예산을 일간 한도보다 낮게 잡아 총예산 검사에 먼저 걸리게 한다
        vm.prank(owner);
        account.setPolicy(_policy(1_500e6, false));

        vm.startPrank(agent);
        account.pay(merchant, PER_TX_CAP);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyAccount.TotalBudgetExceeded.selector, 2_000e6, 1_500e6)
        );
        account.pay(merchant, PER_TX_CAP);
        vm.stopPrank();
    }

    function test_DailyWindowRollsOver() public {
        vm.startPrank(agent);
        for (uint256 i = 0; i < 10; i++) {
            account.pay(merchant, PER_TX_CAP);
        }
        vm.stopPrank();
        assertEq(account.remainingToday(), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        account.pay(merchant, PER_TX_CAP); // 새 윈도우에서 성공

        assertEq(account.spentToday(), PER_TX_CAP);
        assertEq(account.spentTotal(), 11 * PER_TX_CAP);
    }

    function test_RevertWhen_NonAgentPays() public {
        vm.prank(attacker);
        vm.expectRevert(PolicyAccount.NotAgent.selector);
        account.pay(attacker, 1e6);
    }

    function test_RevertWhen_DelegationExpired() public {
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(PolicyAccount.DelegationExpired.selector);
        account.pay(merchant, 1e6);
    }

    // ---------- 결함 2: owner-레지스트리 불일치 ----------

    /// @notice 에이전트가 이 계정의 owner가 아닌 다른 주인에게 바인딩되어 있으면 지출이 막힌다.
    ///         (기존 isAccountableAgent 검사는 "아무 검증된 주인"만 확인해 통과시켰다)
    function test_RevertWhen_AgentBoundToDifferentOwner() public {
        address otherOwner = makeAddr("otherOwner");
        gate.setVerified(otherOwner, true);

        // 에이전트를 다른 주인에게 재바인딩
        vm.prank(owner);
        registry.revokeBinding(agent);
        vm.prank(otherOwner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(otherOwner);

        // 레지스트리상으로는 여전히 "검증된 주인에게 귀속된" 상태지만,
        // 이 계정의 owner는 아니므로 막혀야 한다
        assertTrue(registry.isAccountableAgent(agent), "agent is still accountable to someone");
        vm.prank(agent);
        vm.expectRevert(PolicyAccount.AgentNotBound.selector);
        account.pay(merchant, 1e6);
    }

    function test_RevertWhen_OwnerVerificationRevoked() public {
        // 주인 KYC 무효화 → 에이전트 즉시 정지 (Grace Period 시나리오)
        gate.setVerified(owner, false);
        vm.prank(agent);
        vm.expectRevert(PolicyAccount.AgentNotBound.selector);
        account.pay(merchant, 1e6);
    }

    // ---------- 개선 4: 뷰 underflow ----------

    /// @notice 주인이 한도를 이미 쓴 금액보다 낮춰도 뷰가 revert하지 않고 0을 반환한다.
    function test_RemainingViewsSaturateAfterPolicyDowngrade() public {
        vm.startPrank(agent);
        account.pay(merchant, PER_TX_CAP);
        account.pay(merchant, PER_TX_CAP);
        vm.stopPrank();
        assertEq(account.spentTotal(), 2_000e6);

        // 총예산·일간 한도를 이미 쓴 금액 미만으로 하향
        vm.prank(owner);
        account.setPolicy(
            PolicyAccount.Policy({
                totalBudget: 500e6,
                perTxCap: PER_TX_CAP,
                dailyCap: 500e6,
                validUntil: uint64(block.timestamp + 7 days),
                verifiedRecipientOnly: false
            })
        );

        assertEq(account.remainingBudget(), 0, "should saturate to 0, not revert");
        assertEq(account.remainingToday(), 0, "should saturate to 0, not revert");
    }

    // ---------- verifiedRecipientOnly ----------

    function test_VerifiedRecipientOnlyPolicy() public {
        vm.prank(owner);
        account.setPolicy(_policy(TOTAL_BUDGET, true));

        // 미검증 수신처 → 차단 (프롬프트 인젝션 자금 유출 방어)
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyAccount.RecipientNotVerified.selector, attacker));
        account.pay(attacker, 1e6);

        // 검증된 수신처 → 허용
        gate.setVerified(merchant, true);
        vm.prank(agent);
        account.pay(merchant, 1e6);
        assertEq(token.balanceOf(merchant), 1e6);
    }

    // ---------- 회수 ----------

    function test_OwnerRevokeSweepsTokens() public {
        vm.prank(agent);
        account.pay(merchant, PER_TX_CAP);
        uint256 remaining = account.tokenBalance();

        vm.prank(owner);
        account.revoke();

        assertEq(token.balanceOf(owner), remaining, "owner should recover the full token balance");
        assertEq(account.tokenBalance(), 0);

        vm.prank(agent);
        vm.expectRevert(PolicyAccount.AccountRevoked.selector);
        account.pay(merchant, 1e6);
    }

    function test_RevokeAlsoSweepsStrayEth() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(account).call{value: 1 ether}("");
        assertTrue(sent);

        uint256 before = owner.balance;
        vm.prank(owner);
        account.revoke();

        assertEq(owner.balance, before + 1 ether, "stray ETH should be recovered too");
        assertEq(address(account).balance, 0);
    }

    /// @notice 토큰이 일시정지되어 회수가 불가능해도 정지 자체는 반드시 성공해야 한다.
    ///         (정지와 회수를 한 트랜잭션에 묶으면 전송 실패가 정지까지 되돌린다)
    function test_RevokeHaltsEvenWhenTokenPaused() public {
        token.pause();

        vm.prank(owner);
        account.revoke();

        assertTrue(account.revoked(), "halt must not depend on the token transfer");
        assertEq(account.tokenBalance(), FUNDING, "funds stay put while paused");

        // 정지됐으므로 언패즈 후에도 에이전트는 쓸 수 없다
        token.unpause();
        vm.prank(agent);
        vm.expectRevert(PolicyAccount.AccountRevoked.selector);
        account.pay(merchant, 1e6);

        // 남은 자금은 withdraw로 회수한다
        vm.prank(owner);
        account.withdraw();
        assertEq(token.balanceOf(owner), FUNDING);
        assertEq(account.tokenBalance(), 0);
    }

    function test_WithdrawRecoversTokenAndEth() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(account).call{value: 1 ether}("");
        assertTrue(sent);

        uint256 ethBefore = owner.balance;
        vm.prank(owner);
        account.withdraw();

        assertEq(token.balanceOf(owner), FUNDING);
        assertEq(owner.balance, ethBefore + 1 ether);
    }

    function test_RevertWhen_NonOwnerWithdraws() public {
        vm.prank(attacker);
        vm.expectRevert(PolicyAccount.NotOwner.selector);
        account.withdraw();
    }

    // ---------- 토큰 일시정지 ----------

    /// @notice 토큰이 pause되면 SafeERC20이 원래 revert 사유를 그대로 올린다.
    function test_RevertWhen_TokenPaused() public {
        token.pause();

        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        account.pay(merchant, 1e6);

        // 해제 후에는 정상 동작
        token.unpause();
        vm.prank(agent);
        account.pay(merchant, 1e6);
        assertEq(token.balanceOf(merchant), 1e6);
    }
}
