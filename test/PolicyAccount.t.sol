// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVerifiedGate} from "../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";
import {PolicyAccount} from "../src/PolicyAccount.sol";

contract PolicyAccountTest is Test {
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    PolicyAccount account;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address merchant = makeAddr("merchant");
    address attacker = makeAddr("attacker");

    function setUp() public {
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);

        // 주인 KYC 검증 처리 (데모: mock)
        gate.setVerified(owner, true);

        // 바인딩: 주인 제안 → 에이전트 수락
        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding();

        // 정책 지갑 생성 + 예산 예치
        PolicyAccount.Policy memory p = PolicyAccount.Policy({
            totalBudget: 1 ether,
            perTxCap: 0.1 ether,
            dailyCap: 0.5 ether,
            validUntil: uint64(block.timestamp + 7 days),
            verifiedRecipientOnly: false
        });
        account = new PolicyAccount(owner, agent, registry, gate, p);
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        (bool ok,) = address(account).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_AgentCanSpendWithinPolicy() public {
        vm.prank(agent);
        account.execute(merchant, 0.05 ether, "");
        assertEq(merchant.balance, 0.05 ether);
        assertEq(account.spentTotal(), 0.05 ether);
    }

    function test_RevertWhen_PerTxCapExceeded() public {
        vm.prank(agent);
        vm.expectRevert(); // PerTxCapExceeded
        account.execute(merchant, 0.2 ether, "");
    }

    function test_RevertWhen_DailyCapExceeded() public {
        vm.startPrank(agent);
        for (uint256 i = 0; i < 5; i++) {
            account.execute(merchant, 0.1 ether, "");
        }
        vm.expectRevert(); // DailyCapExceeded
        account.execute(merchant, 0.1 ether, "");
        vm.stopPrank();
    }

    function test_DailyWindowRollsOver() public {
        vm.startPrank(agent);
        for (uint256 i = 0; i < 5; i++) {
            account.execute(merchant, 0.1 ether, "");
        }
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        account.execute(merchant, 0.1 ether, ""); // 새 윈도우에서 성공
    }

    function test_RevertWhen_NonAgentExecutes() public {
        vm.prank(attacker);
        vm.expectRevert(); // NotAgent
        account.execute(attacker, 0.01 ether, "");
    }

    function test_OwnerRevokeSweepsFunds() public {
        uint256 before = owner.balance;
        vm.prank(owner);
        account.revoke();
        assertEq(owner.balance, before + 1 ether);

        vm.prank(agent);
        vm.expectRevert(); // AccountRevoked
        account.execute(merchant, 0.01 ether, "");
    }

    function test_RevertWhen_OwnerVerificationRevoked() public {
        // 주인 KYC 무효화 → 에이전트 즉시 정지 (Grace Period 시나리오)
        gate.setVerified(owner, false);
        vm.prank(agent);
        vm.expectRevert(); // AgentNotBound
        account.execute(merchant, 0.01 ether, "");
    }

    function test_VerifiedRecipientOnlyPolicy() public {
        PolicyAccount.Policy memory p = PolicyAccount.Policy({
            totalBudget: 1 ether,
            perTxCap: 0.1 ether,
            dailyCap: 0.5 ether,
            validUntil: uint64(block.timestamp + 7 days),
            verifiedRecipientOnly: true
        });
        vm.prank(owner);
        account.setPolicy(p);

        // 미검증 수신처 → 차단 (프롬프트 인젝션 자금 유출 방어)
        vm.prank(agent);
        vm.expectRevert(); // RecipientNotVerified
        account.execute(attacker, 0.01 ether, "");

        // 검증된 수신처 → 허용
        gate.setVerified(merchant, true);
        vm.prank(agent);
        account.execute(merchant, 0.01 ether, "");
    }
}
