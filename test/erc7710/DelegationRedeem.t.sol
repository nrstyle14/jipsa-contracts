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

/// @notice ERC-7710 위임 리딤 통합 테스트 (EIP-7702 모델).
///
/// @dev 기존 PolicyAccount 모델과 격리 방식이 다르다. 여기서는 예치가 없고
///      주인 EOA 잔액이 곧 위임 대상이므로, **피해 상한은 enforcer가 강제하는 캡**이다.
///      따라서 caveat 구성이 곧 금고 칸막이이며, 이 테스트가 그 칸막이를 검증한다.
contract DelegationRedeemTest is Test {
    JipsaSettlementToken token;
    MockVerifiedGate gate;
    OwnerBindingRegistry registry;
    DelegationManager delegationManager;
    EIP7702StatelessDeleGator deleGatorImpl;

    DojangCaveatEnforcer dojangEnforcer;
    JipsaPerTxCapEnforcer perTxEnforcer;
    ERC20TransferAmountEnforcer totalBudgetEnforcer;

    address owner;
    uint256 ownerPk;
    address agent = makeAddr("agent");
    address merchant = makeAddr("merchant");

    uint256 constant TOTAL_BUDGET = 100_000e6;
    uint256 constant PER_TX_CAP = 1_000e6;
    uint256 constant FUNDING = 100_000e6;

    function setUp() public {
        (owner, ownerPk) = makeAddrAndKey("owner");

        token = new JipsaSettlementToken();
        gate = new MockVerifiedGate();
        registry = new OwnerBindingRegistry(gate);

        // EntryPoint는 이 MVP에서 쓰지 않는다 (에이전트 리딤은 일반 tx).
        // 생성자 인자로만 필요하므로 더미 주소를 넣는다.
        delegationManager = new DelegationManager(address(this));
        deleGatorImpl = new EIP7702StatelessDeleGator(
            IDelegationManager(address(delegationManager)), IEntryPoint(makeAddr("entryPoint"))
        );

        dojangEnforcer = new DojangCaveatEnforcer();
        perTxEnforcer = new JipsaPerTxCapEnforcer();
        totalBudgetEnforcer = new ERC20TransferAmountEnforcer();

        // 주인 EOA에 7702 코드 부여 (delegation designator)
        vm.etch(owner, bytes.concat(hex"ef0100", abi.encodePacked(address(deleGatorImpl))));

        // 주인 도장 + 바인딩
        gate.setVerified(owner, true);
        vm.prank(owner);
        registry.proposeBinding(agent);
        vm.prank(agent);
        registry.acceptBinding(owner);

        // 예치 없음 — 주인 EOA가 그대로 위임 계정이다
        token.mint(owner, FUNDING);
    }

    // ---------- 헬퍼 ----------

    function _caveats(bool verifiedRecipientOnly) internal view returns (Caveat[] memory caveats_) {
        caveats_ = new Caveat[](3);
        caveats_[0] = Caveat({
            enforcer: address(totalBudgetEnforcer),
            terms: abi.encodePacked(address(token), TOTAL_BUDGET),
            args: hex""
        });
        caveats_[1] = Caveat({
            enforcer: address(perTxEnforcer),
            terms: abi.encodePacked(address(token), PER_TX_CAP),
            args: hex""
        });
        caveats_[2] = Caveat({
            enforcer: address(dojangEnforcer),
            terms: abi.encode(address(gate), address(registry), address(token), verifiedRecipientOnly),
            args: hex""
        });
    }

    function _signedDelegation(address delegate, bool verifiedRecipientOnly)
        internal
        view
        returns (Delegation memory delegation_)
    {
        delegation_ = Delegation({
            delegate: delegate,
            delegator: owner,
            authority: delegationManager.ROOT_AUTHORITY(),
            caveats: _caveats(verifiedRecipientOnly),
            salt: 0,
            signature: hex""
        });
        delegation_.signature = _sign(ownerPk, delegation_);
    }

    function _sign(uint256 pk, Delegation memory delegation_) internal view returns (bytes memory) {
        bytes32 typedDataHash_ = MessageHashUtils.toTypedDataHash(
            delegationManager.getDomainHash(), EncoderLib._getDelegationHash(delegation_)
        );
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(pk, typedDataHash_);
        return abi.encodePacked(r_, s_, v_);
    }

    /// @dev 에이전트가 일반 tx로 리딤한다 (번들러 불필요)
    function _redeem(address redeemer, Delegation memory delegation_, address to, uint256 amount) internal {
        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = delegation_;

        bytes[] memory permissionContexts_ = new bytes[](1);
        permissionContexts_[0] = abi.encode(delegations_);

        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();

        bytes[] memory executionCallDatas_ = new bytes[](1);
        executionCallDatas_[0] = ExecutionLib.encodeSingle(
            address(token), 0, abi.encodeWithSelector(token.transfer.selector, to, amount)
        );

        vm.prank(redeemer);
        delegationManager.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);
    }

    // ---------- C-5-1: 정상 리딤 ----------

    function test_AgentRedeemsAndTokenMoves() public {
        Delegation memory d_ = _signedDelegation(agent, false);
        _redeem(agent, d_, merchant, PER_TX_CAP);

        assertEq(token.balanceOf(merchant), PER_TX_CAP, "merchant should receive tKRW");
        assertEq(token.balanceOf(owner), FUNDING - PER_TX_CAP, "spent from owner EOA directly");

        // 총예산 enforcer 누적치 갱신 확인
        bytes32 hash_ = EncoderLib._getDelegationHash(d_);
        assertEq(
            totalBudgetEnforcer.spentMap(address(delegationManager), hash_),
            PER_TX_CAP,
            "enforcer should track cumulative spend"
        );
    }

    // ---------- C-5-2: 한도 위반 ----------

    function test_RevertWhen_PerTxCapExceeded() public {
        Delegation memory d_ = _signedDelegation(agent, false);

        vm.expectRevert(
            abi.encodeWithSelector(
                JipsaPerTxCapEnforcer.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP
            )
        );
        _redeem(agent, d_, merchant, PER_TX_CAP + 1);
    }

    // ---------- C-5-3: Dojang ----------

    /// @notice 도장 없는 수신처로는 리딤할 수 없다
    function test_RevertWhen_RecipientNotVerified() public {
        Delegation memory d_ = _signedDelegation(agent, true);

        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.RecipientNotVerified.selector, merchant)
        );
        _redeem(agent, d_, merchant, PER_TX_CAP);

        // 도장을 부여하면 통과
        gate.setVerified(merchant, true);
        _redeem(agent, d_, merchant, PER_TX_CAP);
        assertEq(token.balanceOf(merchant), PER_TX_CAP);
    }

    /// @notice 주인 도장이 무효화되면 즉시 정지된다
    function test_RevertWhen_OwnerVerificationRevoked() public {
        Delegation memory d_ = _signedDelegation(agent, false);
        gate.setVerified(owner, false);

        vm.expectRevert(abi.encodeWithSelector(DojangCaveatEnforcer.OwnerNotVerified.selector, owner));
        _redeem(agent, d_, merchant, PER_TX_CAP);
    }

    /// @notice 이 주인에게 바인딩되지 않은 에이전트는 리딤할 수 없다.
    ///         (스톡 enforcer만으로는 막히지 않는 JIPSA 고유 계층)
    function test_RevertWhen_RedeemerNotBoundToDelegator() public {
        address stranger = makeAddr("strangerAgent");

        // 다른 주인에게 바인딩된 에이전트
        address otherOwner = makeAddr("otherOwner");
        gate.setVerified(otherOwner, true);
        vm.prank(otherOwner);
        registry.proposeBinding(stranger);
        vm.prank(stranger);
        registry.acceptBinding(otherOwner);

        // 주인이 그 에이전트에게 위임을 발급했더라도 바인딩 불일치로 막힌다
        Delegation memory d_ = _signedDelegation(stranger, false);

        vm.expectRevert(
            abi.encodeWithSelector(DojangCaveatEnforcer.AgentNotBound.selector, stranger, owner)
        );
        _redeem(stranger, d_, merchant, PER_TX_CAP);
    }

    // ---------- C-5-4: 철회 ----------

    /// @notice 주인이 직접 disableDelegation을 호출하면 이후 리딤이 막힌다.
    ///         자금이 원래 주인 지갑에 있으므로 회수(sweep) 단계가 없다.
    function test_DisableDelegationBlocksRedeem() public {
        Delegation memory d_ = _signedDelegation(agent, false);
        _redeem(agent, d_, merchant, PER_TX_CAP);

        vm.prank(owner);
        delegationManager.disableDelegation(d_);

        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(agent, d_, merchant, PER_TX_CAP);

        // 잔액은 계속 주인 소유 — 회수할 대상이 애초에 없다
        assertEq(token.balanceOf(owner), FUNDING - PER_TX_CAP);
    }

    // ---------- C-5-6: 서명 검증 ----------

    /// @notice 주인이 아닌 키로 서명한 위임은 ERC-1271 경로에서 거부된다
    function test_RevertWhen_SignedByWrongKey() public {
        (, uint256 attackerPk) = makeAddrAndKey("attacker");

        Delegation memory d_ = Delegation({
            delegate: agent,
            delegator: owner,
            authority: delegationManager.ROOT_AUTHORITY(),
            caveats: _caveats(false),
            salt: 0,
            signature: hex""
        });
        d_.signature = _sign(attackerPk, d_);

        vm.expectRevert(IDelegationManager.InvalidERC1271Signature.selector);
        _redeem(agent, d_, merchant, PER_TX_CAP);
    }
}
