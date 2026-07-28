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

/// @notice 지시서 B-4의 caveat 7종 전체 조합 검증.
///
/// @dev caveat은 배열 순서대로 실행된다. 스톡 enforcer를 앞에 두어 타겟·메서드
///      위반이 스톡에서 먼저 걸리게 하고, JIPSA enforcer를 뒤에 둔다.
///      7702 모델에서는 이 조합이 곧 금고 칸막이다 — 주인 EOA 잔액 전체가
///      위임 대상이므로 피해 상한은 enforcer 캡이 결정한다.
contract FullCaveatSetTest is Test {
    JipsaSettlementToken token;
    JipsaSettlementToken otherToken;
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    DelegationManager delegationManager;

    AllowedTargetsEnforcer allowedTargets;
    AllowedMethodsEnforcer allowedMethods;
    ERC20TransferAmountEnforcer totalBudget;
    ERC20PeriodTransferEnforcer dailyCap;
    TimestampEnforcer timestamps;
    JipsaPerTxCapEnforcer perTxCap;
    DojangCaveatEnforcer dojang;

    address owner;
    uint256 ownerPk;
    address agent = makeAddr("agent");
    address merchant = makeAddr("merchant");

    uint256 constant TOTAL_BUDGET = 100_000e6;
    uint256 constant DAILY_CAP = 3_000e6;
    uint256 constant PER_TX_CAP = 1_000e6;
    uint256 constant FUNDING = 100_000e6;
    uint64 expiry;

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("owner");
        expiry = uint64(block.timestamp + 7 days);

        token = new JipsaSettlementToken();
        otherToken = new JipsaSettlementToken();
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);
        delegationManager = new DelegationManager(address(this));

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

    // ---------- caveat 구성 ----------

    /// @dev 지시서 B-4 순서: AllowedTargets → AllowedMethods → 총예산 → 일간 →
    ///      만료 → 건당 → Dojang
    function _caveats() internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](7);
        c_[0] = Caveat({
            enforcer: address(allowedTargets),
            terms: abi.encodePacked(address(token)),
            args: hex""
        });
        c_[1] = Caveat({
            enforcer: address(allowedMethods),
            terms: abi.encodePacked(token.transfer.selector),
            args: hex""
        });
        c_[2] = Caveat({
            enforcer: address(totalBudget),
            terms: abi.encodePacked(address(token), TOTAL_BUDGET),
            args: hex""
        });
        c_[3] = Caveat({
            enforcer: address(dailyCap),
            // token || periodAmount || periodDuration || startDate
            terms: abi.encodePacked(address(token), DAILY_CAP, uint256(1 days), uint256(block.timestamp)),
            args: hex""
        });
        c_[4] = Caveat({
            enforcer: address(timestamps),
            // uint128 after || uint128 before
            terms: abi.encodePacked(uint128(0), uint128(expiry)),
            args: hex""
        });
        c_[5] = Caveat({
            enforcer: address(perTxCap),
            terms: abi.encodePacked(address(token), PER_TX_CAP),
            args: hex""
        });
        c_[6] = Caveat({
            enforcer: address(dojang),
            terms: abi.encode(address(gate), address(registry), address(token), false),
            args: hex""
        });
    }

    function _signed() internal view returns (Delegation memory d_) {
        return _signWith(_caveats(), 0);
    }

    function _signWith(Caveat[] memory caveats_, uint256 salt_) internal view returns (Delegation memory d_) {
        d_ = Delegation({
            delegate: agent,
            delegator: owner,
            authority: delegationManager.ROOT_AUTHORITY(),
            caveats: caveats_,
            salt: salt_,
            signature: hex""
        });
        bytes32 typedDataHash_ = MessageHashUtils.toTypedDataHash(
            delegationManager.getDomainHash(), EncoderLib._getDelegationHash(d_)
        );
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(ownerPk, typedDataHash_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }

    function _redeem(Delegation memory d_, bytes memory executionCallData) internal {
        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = d_;

        bytes[] memory permissionContexts_ = new bytes[](1);
        permissionContexts_[0] = abi.encode(delegations_);

        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();

        bytes[] memory executionCallDatas_ = new bytes[](1);
        executionCallDatas_[0] = executionCallData;

        vm.prank(agent);
        delegationManager.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);
    }

    function _transfer(address to, uint256 amount) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(token), 0, abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
    }

    // ---------- 정상 ----------

    function test_AllSevenCaveatsCompose() public {
        Delegation memory d_ = _signed();
        _redeem(d_, _transfer(merchant, PER_TX_CAP));

        assertEq(token.balanceOf(merchant), PER_TX_CAP);
        assertEq(token.balanceOf(owner), FUNDING - PER_TX_CAP);
    }

    // ---------- 위반: 타겟 ----------

    function test_RevertWhen_TargetNotAllowed() public {
        Delegation memory d_ = _signed();

        bytes memory badTarget_ = ExecutionLib.encodeSingle(
            address(otherToken), 0, abi.encodeWithSelector(token.transfer.selector, merchant, PER_TX_CAP)
        );

        vm.expectRevert(bytes("AllowedTargetsEnforcer:target-address-not-allowed"));
        _redeem(d_, badTarget_);
    }

    // ---------- 위반: 메서드 ----------

    function test_RevertWhen_MethodNotAllowed() public {
        Delegation memory d_ = _signed();

        bytes memory badMethod_ = ExecutionLib.encodeSingle(
            address(token), 0, abi.encodeWithSelector(token.approve.selector, merchant, PER_TX_CAP)
        );

        vm.expectRevert(bytes("AllowedMethodsEnforcer:method-not-allowed"));
        _redeem(d_, badMethod_);
    }

    // ---------- 위반: 건당 ----------

    function test_RevertWhen_PerTxCapExceeded() public {
        Delegation memory d_ = _signed();

        vm.expectRevert(
            abi.encodeWithSelector(
                JipsaPerTxCapEnforcer.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP
            )
        );
        _redeem(d_, _transfer(merchant, PER_TX_CAP + 1));
    }

    // ---------- 위반: 일간 한도 (기간형 enforcer) ----------

    function test_DailyCapExhaustsAndResetsNextPeriod() public {
        Delegation memory d_ = _signed();

        // 3 × 1,000 = 3,000 = 일간 한도 소진
        for (uint256 i = 0; i < 3; i++) {
            _redeem(d_, _transfer(merchant, PER_TX_CAP));
        }
        assertEq(token.balanceOf(merchant), DAILY_CAP);

        vm.expectRevert(bytes("ERC20PeriodTransferEnforcer:transfer-amount-exceeded"));
        _redeem(d_, _transfer(merchant, PER_TX_CAP));

        // 다음 기간에는 다시 가능
        vm.warp(block.timestamp + 1 days);
        _redeem(d_, _transfer(merchant, PER_TX_CAP));
        assertEq(token.balanceOf(merchant), DAILY_CAP + PER_TX_CAP);
    }

    // ---------- 위반: 총예산 ----------

    function test_RevertWhen_TotalBudgetExceeded() public {
        // 총예산을 일간 한도보다 낮게 잡아 총예산 검사에 먼저 걸리게 한다
        Caveat[] memory c_ = _caveats();
        c_[2].terms = abi.encodePacked(address(token), uint256(1_500e6));
        Delegation memory d_ = _signWith(c_, 1);

        _redeem(d_, _transfer(merchant, PER_TX_CAP));

        vm.expectRevert(bytes("ERC20TransferAmountEnforcer:allowance-exceeded"));
        _redeem(d_, _transfer(merchant, PER_TX_CAP));

        assertEq(token.balanceOf(merchant), PER_TX_CAP, "only the first transfer should land");
    }

    // ---------- 위반: 만료 ----------

    function test_RevertWhen_DelegationExpired() public {
        Delegation memory d_ = _signed();
        vm.warp(uint256(expiry) + 1);

        vm.expectRevert(bytes("TimestampEnforcer:expired-delegation"));
        _redeem(d_, _transfer(merchant, PER_TX_CAP));
    }
}
