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
import {AllowedTargetsEnforcer} from "delegation-framework/src/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/src/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20TransferAmountEnforcer} from "delegation-framework/src/enforcers/ERC20TransferAmountEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/src/enforcers/TimestampEnforcer.sol";

import {JipsaSettlementToken} from "../../src/JipsaSettlementToken.sol";
import {MockVerifiedGate} from "../../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../../src/OwnerBindingRegistry.sol";
import {DojangCaveatEnforcer} from "../../src/enforcers/DojangCaveatEnforcer.sol";
import {JipsaPerTxCapEnforcer} from "../../src/enforcers/JipsaPerTxCapEnforcer.sol";

/// @notice MVP 시나리오의 데모 정책·차단 사유를 코드로 고정한다.
///
/// @dev 데모 영상 대본이 특정 revert 사유를 화면에 띄우기로 되어 있으므로,
///      caveat 순서가 바뀌어 사유가 달라지면 이 테스트가 깨져야 한다.
///      데모 정책: 총예산 5,000 · 건당 50 · 일간 500 · 7일 · 검증수신처 ON
contract DemoScenarioTest is Test {
    JipsaSettlementToken token;
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    DelegationManager dm;

    AllowedTargetsEnforcer allowedTargets;
    AllowedMethodsEnforcer allowedMethods;
    ERC20TransferAmountEnforcer totalBudget;
    ERC20PeriodTransferEnforcer dailyCap;
    TimestampEnforcer timestamps;
    JipsaPerTxCapEnforcer perTxCap;
    DojangCaveatEnforcer dojang;

    address owner;
    uint256 ownerPk;
    address agent = makeAddr("researchBot");
    address merchantA = makeAddr("merchantA"); // 도장 보유 가맹처
    address attacker = makeAddr("attackerX"); // 도장 없음

    // MVP 시나리오 데모 정책
    uint256 constant TOTAL_BUDGET = 5_000e6;
    uint256 constant PER_TX_CAP = 50e6;
    uint256 constant DAILY_CAP = 500e6;
    uint256 constant PAY = 2e6; // Act 2 건당 결제액

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("owner");

        token = new JipsaSettlementToken();
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);
        dm = new DelegationManager(address(this));

        allowedTargets = new AllowedTargetsEnforcer();
        allowedMethods = new AllowedMethodsEnforcer();
        totalBudget = new ERC20TransferAmountEnforcer();
        dailyCap = new ERC20PeriodTransferEnforcer();
        timestamps = new TimestampEnforcer();
        perTxCap = new JipsaPerTxCapEnforcer();
        dojang = new DojangCaveatEnforcer();

        vm.etch(
            owner,
            bytes.concat(
                hex"ef0100",
                abi.encodePacked(
                    address(
                        new EIP7702StatelessDeleGator(
                            IDelegationManager(address(dm)), IEntryPoint(makeAddr("entryPoint"))
                        )
                    )
                )
            )
        );

        // 주인·가맹처 A 도장 발급 (공격자는 미발급)
        gate.setVerified(owner, true);
        gate.setVerified(merchantA, true);

        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(owner);

        token.mint(owner, 10_000e6);
    }

    /// @dev 확정된 caveat 순서 — FullCaveatSet.t.sol과 동일해야 한다
    function _caveats() internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](7);
        c_[0] = Caveat(address(allowedTargets), abi.encodePacked(address(token)), hex"");
        c_[1] = Caveat(address(allowedMethods), abi.encodePacked(token.transfer.selector), hex"");
        c_[2] = Caveat(address(timestamps), abi.encodePacked(uint128(0), uint128(block.timestamp + 7 days)), hex"");
        c_[3] = Caveat(address(perTxCap), abi.encodePacked(address(token), PER_TX_CAP), hex"");
        c_[4] = Caveat(address(totalBudget), abi.encodePacked(address(token), TOTAL_BUDGET), hex"");
        c_[5] = Caveat(
            address(dailyCap),
            abi.encodePacked(address(token), DAILY_CAP, uint256(1 days), uint256(block.timestamp)),
            hex""
        );
        c_[6] = Caveat(address(dojang), abi.encode(address(gate), address(registry), address(token), true), hex"");
    }

    function _signed() internal view returns (Delegation memory d_) {
        d_ = Delegation(agent, owner, dm.ROOT_AUTHORITY(), _caveats(), 0, hex"");
        bytes32 h_ = MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d_));
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(ownerPk, h_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }

    function _redeem(Delegation memory d_, address to, uint256 amount) internal {
        Delegation[] memory ds_ = new Delegation[](1);
        ds_[0] = d_;
        bytes[] memory pc_ = new bytes[](1);
        pc_[0] = abi.encode(ds_);
        ModeCode[] memory m_ = new ModeCode[](1);
        m_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory ec_ = new bytes[](1);
        ec_[0] = ExecutionLib.encodeSingle(
            address(token), 0, abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
        vm.prank(agent);
        dm.redeemDelegations(pc_, m_, ec_);
    }

    /// @notice Act 2 — 번역 3건, 건당 2 tKRW 자율 결제
    function test_Act2_NormalPayments() public {
        Delegation memory d_ = _signed();
        for (uint256 i = 0; i < 3; i++) {
            _redeem(d_, merchantA, PAY);
        }
        assertEq(token.balanceOf(merchantA), 3 * PAY, "merchantA receives all three payments");
    }

    /// @notice Act 3 첫 차단 — 전액 시도는 **건당 상한**에서 막혀야 한다.
    ///         (데모 내레이션이 PerTxCapExceeded를 띄우므로 사유가 고정되어야 함)
    function test_Act3_FullAmountBlockedByPerTxCap() public {
        Delegation memory d_ = _signed();

        vm.expectRevert(
            abi.encodeWithSelector(
                JipsaPerTxCapEnforcer.PerTxCapExceeded.selector, TOTAL_BUDGET, PER_TX_CAP
            )
        );
        _redeem(d_, attacker, TOTAL_BUDGET);
    }

    /// @notice Act 3 둘째 차단 — 한도 이하로 낮춰도 미검증 수신처라 막힌다
    function test_Act3_ReducedAmountBlockedByDojang() public {
        Delegation memory d_ = _signed();

        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.RecipientNotVerified.selector, attacker)
        );
        _redeem(d_, attacker, 49e6);
    }

    /// @notice Act 3 마무리 — 차단 후에도 정상 결제는 계속된다 (서비스가 죽지 않음)
    function test_Act3_ServiceSurvivesAfterBlock() public {
        Delegation memory d_ = _signed();

        vm.expectRevert();
        _redeem(d_, attacker, TOTAL_BUDGET);

        _redeem(d_, merchantA, PAY);
        assertEq(token.balanceOf(merchantA), PAY, "normal payment still succeeds after the block");
    }

    /// @notice Act 4 — 주인이 권한만 끊는다. 자금은 처음부터 주인 지갑에 있다.
    function test_Act4_DisableStopsAgentWithoutSweep() public {
        Delegation memory d_ = _signed();
        _redeem(d_, merchantA, PAY);
        uint256 ownerBalance_ = token.balanceOf(owner);

        vm.prank(owner);
        dm.disableDelegation(d_);

        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(d_, merchantA, PAY);

        assertEq(token.balanceOf(owner), ownerBalance_, "no sweep step - owner balance unchanged");
    }
}
