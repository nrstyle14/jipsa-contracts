// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IEntryPoint} from "@account-abstraction/interfaces/IEntryPoint.sol";
import {ModeLib} from "@erc7579/lib/ModeLib.sol";
import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";

import {DelegationManager} from "delegation-framework/src/DelegationManager.sol";
import {IDelegationManager} from "delegation-framework/src/interfaces/IDelegationManager.sol";
import {EIP7702StatelessDeleGator} from "delegation-framework/src/EIP7702/EIP7702StatelessDeleGator.sol";
import {EncoderLib} from "delegation-framework/src/libraries/EncoderLib.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/src/utils/Types.sol";
import {ERC20TransferAmountEnforcer} from "delegation-framework/src/enforcers/ERC20TransferAmountEnforcer.sol";

import {JipsaSettlementToken} from "../../src/JipsaSettlementToken.sol";
import {MockVerifiedGate} from "../../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../../src/OwnerBindingRegistry.sol";
import {DojangCaveatEnforcer} from "../../src/enforcers/DojangCaveatEnforcer.sol";
import {JipsaPerTxCapEnforcer} from "../../src/enforcers/JipsaPerTxCapEnforcer.sol";

/// @notice 건당 상한만으로는 누적 손실이 제한되지 않는다는 사실을 명시적으로 고정한다.
///
/// @dev `JipsaPerTxCapEnforcer`는 설계상 **실행 1건당** 금액만 본다. 위임은
///      `disableDelegation` 전까지 무제한 재사용 가능하고 리딤 횟수 제한이 없으므로,
///      caveat이 `[건당상한, Dojang]` 둘뿐이면 에이전트 키를 쥔 공격자가 상한 이하
///      리딤을 반복해 주인 EOA 잔액 전체를 뺄 수 있다. 배치 리딤이면 한 트랜잭션으로도 된다.
///
///      7702 모델에서는 예치가 없어 주인 EOA 잔액 전체가 위임 표면이므로, 이는
///      "피해가 위임 한도 안에 갇힌다"는 제품 명제가 무너지는 지점이다.
///      따라서 **누적 상한(ERC20TransferAmountEnforcer)을 항상 함께 넣어야 한다.**
contract CumulativeDrainTest is Test {
    JipsaSettlementToken token;
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    DelegationManager delegationManager;
    DojangCaveatEnforcer dojang;
    JipsaPerTxCapEnforcer perTx;
    ERC20TransferAmountEnforcer totalBudget;

    address owner;
    uint256 ownerPk;
    address agent = makeAddr("agent");
    address attackerSink = makeAddr("attackerSink");

    uint256 constant PER_TX_CAP = 1_000e6;
    uint256 constant TOTAL_CAP = 2_000e6;
    uint256 constant FUNDING = 50_000e6;

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("owner");

        token = new JipsaSettlementToken();
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);
        delegationManager = new DelegationManager(address(this));
        dojang = new DojangCaveatEnforcer();
        perTx = new JipsaPerTxCapEnforcer();
        totalBudget = new ERC20TransferAmountEnforcer();

        vm.etch(
            owner,
            bytes.concat(
                hex"ef0100",
                abi.encodePacked(
                    address(
                        new EIP7702StatelessDeleGator(
                            IDelegationManager(address(delegationManager)),
                            IEntryPoint(makeAddr("entryPoint"))
                        )
                    )
                )
            )
        );

        gate.setVerified(owner, true);
        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(owner);

        token.mint(owner, FUNDING);
    }

    function _sign(Caveat[] memory caveats_) internal view returns (Delegation memory d_) {
        d_ = Delegation({
            delegate: agent,
            delegator: owner,
            authority: delegationManager.ROOT_AUTHORITY(),
            caveats: caveats_,
            salt: 0,
            signature: hex""
        });
        bytes32 h_ = MessageHashUtils.toTypedDataHash(
            delegationManager.getDomainHash(), EncoderLib._getDelegationHash(d_)
        );
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(ownerPk, h_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }

    function _perTxOnly() internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](2);
        c_[0] = Caveat({
            enforcer: address(perTx),
            terms: abi.encodePacked(address(token), PER_TX_CAP),
            args: hex""
        });
        c_[1] = Caveat({
            enforcer: address(dojang),
            terms: abi.encode(address(gate), address(registry), address(token), false),
            args: hex""
        });
    }

    function _withTotalCap() internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](3);
        c_[0] = Caveat({
            enforcer: address(totalBudget),
            terms: abi.encodePacked(address(token), TOTAL_CAP),
            args: hex""
        });
        Caveat[] memory base_ = _perTxOnly();
        c_[1] = base_[0];
        c_[2] = base_[1];
    }

    /// @dev N건을 한 트랜잭션에 배치로 리딤한다 (동일 위임 반복 사용)
    function _batchRedeem(Delegation memory d_, uint256 n, uint256 amountEach) internal {
        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = d_;
        bytes memory context_ = abi.encode(delegations_);

        bytes[] memory permissionContexts_ = new bytes[](n);
        ModeCode[] memory modes_ = new ModeCode[](n);
        bytes[] memory executionCallDatas_ = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            permissionContexts_[i] = context_;
            modes_[i] = ModeLib.encodeSimpleSingle();
            executionCallDatas_[i] = ExecutionLib.encodeSingle(
                address(token),
                0,
                abi.encodeWithSelector(token.transfer.selector, attackerSink, amountEach)
            );
        }

        vm.prank(agent);
        delegationManager.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);
    }

    /// @notice 결함 고정: 건당 상한만 있으면 반복 리딤으로 상한을 훨씬 넘는 금액이 빠진다.
    ///         이 테스트가 통과한다는 것 자체가 "건당 상한은 누적 보호가 아니다"의 증거다.
    function test_PerTxCapAloneDoesNotBoundCumulativeLoss() public {
        Delegation memory d_ = _sign(_perTxOnly());

        // 상한 이하(각 1,000)로 20건 → 20,000이 빠진다. 건당 상한은 전혀 막지 못한다.
        _batchRedeem(d_, 20, PER_TX_CAP);

        assertEq(
            token.balanceOf(attackerSink),
            20 * PER_TX_CAP,
            "per-tx cap alone lets the agent drain far beyond the cap"
        );
        assertEq(token.balanceOf(owner), FUNDING - 20 * PER_TX_CAP);
    }

    /// @notice 누적 상한을 함께 넣으면 총액에서 막힌다.
    function test_TotalCapBoundsCumulativeLoss() public {
        Delegation memory d_ = _sign(_withTotalCap());

        // 2건(2,000) = 누적 상한까지는 통과
        _batchRedeem(d_, 2, PER_TX_CAP);
        assertEq(token.balanceOf(attackerSink), TOTAL_CAP);

        // 1건 더는 누적 상한에서 차단
        vm.expectRevert(bytes("ERC20TransferAmountEnforcer:allowance-exceeded"));
        _batchRedeem(d_, 1, PER_TX_CAP);

        assertEq(token.balanceOf(attackerSink), TOTAL_CAP, "loss stays inside the cumulative cap");
    }

    /// @notice 배치가 아니라 별개 트랜잭션으로 나눠도 누적 상한이 유지된다.
    function test_TotalCapHoldsAcrossSeparateTransactions() public {
        Delegation memory d_ = _sign(_withTotalCap());

        _batchRedeem(d_, 1, PER_TX_CAP);
        _batchRedeem(d_, 1, PER_TX_CAP);

        vm.expectRevert(bytes("ERC20TransferAmountEnforcer:allowance-exceeded"));
        _batchRedeem(d_, 1, PER_TX_CAP);

        assertEq(token.balanceOf(attackerSink), TOTAL_CAP);
    }

    /// @notice 주인이 철회하면 즉시 멈춘다 — 누적 상한과 무관한 최종 안전장치
    function test_DisableDelegationStopsDrainImmediately() public {
        Delegation memory d_ = _sign(_perTxOnly());
        _batchRedeem(d_, 1, PER_TX_CAP);

        vm.prank(owner);
        delegationManager.disableDelegation(d_);

        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        _batchRedeem(d_, 1, PER_TX_CAP);

        assertEq(token.balanceOf(attackerSink), PER_TX_CAP);
    }
}
