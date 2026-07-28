// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVerifiedGate} from "../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";

contract OwnerBindingRegistryTest is Test {
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;

    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address agent = makeAddr("agent");

    function setUp() public {
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);
        gate.setVerified(ownerA, true);
        gate.setVerified(ownerB, true);
    }

    // ---------- 결함 1: 수락 프런트러닝 ----------

    /// @notice B가 A의 제안을 덮어쓴 뒤 에이전트가 A를 수락하려 하면 차단된다.
    ///         (덮어쓰기를 못 막더라도, 엉뚱한 주인에게 귀속되는 것은 막아야 한다)
    function test_RevertWhen_ProposalFrontRunBeforeAccept() public {
        vm.prank(ownerA);
        registry.proposeBinding(agent);

        // 공격자(다른 검증 주인)가 같은 에이전트에 제안을 덮어씀
        vm.prank(ownerB);
        registry.proposeBinding(agent);
        assertEq(registry.pendingOwnerOf(agent), ownerB, "proposal should be overwritten");

        // 에이전트는 A를 수락하려 했으므로 revert 되어야 한다
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OwnerBindingRegistry.UnexpectedProposer.selector, ownerA, ownerB)
        );
        registry.acceptBinding(ownerA);

        assertEq(registry.ownerOf(agent), address(0), "agent must not be bound");
    }

    function test_AcceptBindingWithMatchingProposer() public {
        vm.prank(ownerA);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(ownerA);

        assertEq(registry.ownerOf(agent), ownerA);
        assertEq(registry.pendingOwnerOf(agent), address(0), "pending should be cleared");
        assertTrue(registry.isAccountableAgent(agent));
    }

    // ---------- 개선 3: 제안 취소 ----------

    function test_CancelProposalPreventsAccept() public {
        vm.prank(ownerA);
        registry.proposeBinding(agent);

        vm.prank(ownerA);
        registry.cancelProposal(agent);
        assertEq(registry.pendingOwnerOf(agent), address(0), "pending should be cleared");

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(OwnerBindingRegistry.NoPendingProposal.selector, agent));
        registry.acceptBinding(ownerA);
    }

    function test_RevertWhen_NonProposerCancels() public {
        vm.prank(ownerA);
        registry.proposeBinding(agent);

        vm.prank(ownerB);
        vm.expectRevert(OwnerBindingRegistry.NotProposer.selector);
        registry.cancelProposal(agent);

        // 제안은 그대로 남아 있어야 한다
        assertEq(registry.pendingOwnerOf(agent), ownerA);
    }

    // ---------- 기존 동작 ----------

    function test_RevertWhen_UnverifiedOwnerProposes() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnerBindingRegistry.OwnerNotVerified.selector, stranger));
        registry.proposeBinding(agent);
    }

    function test_RevokeBindingClearsAccountability() public {
        vm.prank(ownerA);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(ownerA);

        vm.prank(ownerA);
        registry.revokeBinding(agent);

        assertEq(registry.ownerOf(agent), address(0));
        assertFalse(registry.isAccountableAgent(agent));
        assertEq(registry.agentsOf(ownerA).length, 0);
    }
}
