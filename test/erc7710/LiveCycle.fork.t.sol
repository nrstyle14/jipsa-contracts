// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ModeLib} from "@erc7579/lib/ModeLib.sol";
import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";

import {DelegationManager} from "delegation-framework/src/DelegationManager.sol";
import {IDelegationManager} from "delegation-framework/src/interfaces/IDelegationManager.sol";
import {EncoderLib} from "delegation-framework/src/libraries/EncoderLib.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/src/utils/Types.sol";
import {ERC20TransferAmountEnforcer} from "delegation-framework/src/enforcers/ERC20TransferAmountEnforcer.sol";

import {JipsaSettlementToken} from "../../src/JipsaSettlementToken.sol";
import {DojangVerifiedGate} from "../../src/gates/DojangVerifiedGate.sol";
import {OwnerBindingRegistry} from "../../src/OwnerBindingRegistry.sol";
import {DojangCaveatEnforcer} from "../../src/enforcers/DojangCaveatEnforcer.sol";
import {JipsaPerTxCapEnforcer} from "../../src/enforcers/JipsaPerTxCapEnforcer.sol";

/// @notice GIWA Sepolia에 **실제 배포된 주소**와 **실도장 주인**으로 도는 축약 사이클.
///         지시서 C-5-5에 해당한다.
///
/// 실행:
///   forge test --match-path test/erc7710/LiveCycle.fork.t.sol \
///     --fork-url https://sepolia-rpc.giwa.io
///
/// @dev 주인 EOA는 실체인에서 이미 7702 코드를 보유하고 도장도 받은 상태다.
///      따라서 vm.etch도 mock도 쓰지 않는다 — 포크가 그 상태를 그대로 물려받는다.
///      위임 서명에는 .env의 OWNER_PRIVATE_KEY가 필요하다. 없으면 skip한다.
contract LiveCycleForkTest is Test {
    uint256 internal constant GIWA_SEPOLIA_CHAIN_ID = 91342;

    // GIWA Sepolia 실배포 주소
    JipsaSettlementToken constant TOKEN = JipsaSettlementToken(0x1E743C166FaeeEe5b840A471a6760535AE4076B0);
    DojangVerifiedGate constant GATE = DojangVerifiedGate(0xD13aE574E53F2D14F71411383CcEeC9c16529fc3);
    OwnerBindingRegistry constant REGISTRY = OwnerBindingRegistry(0x6ef7F805fBCaA49cbfc11C861E2EC051549433C7);
    DelegationManager constant DELEGATION_MANAGER =
        DelegationManager(0x46C7b0aaC0Cde81744823a305FBb86D31D4F7F89);
    address constant DELEGATOR_IMPL = 0x50bC6Ac159bd85838Af8A42Fd482B8f633FeA38D;
    DojangCaveatEnforcer constant DOJANG = DojangCaveatEnforcer(0x8C9c8437C27003f3d86F438c7147668d9cC5948C);
    JipsaPerTxCapEnforcer constant PER_TX = JipsaPerTxCapEnforcer(0xdea5DF3357e0EEf6A841d3639d115eb57b42B642);
    /// @dev 누적 상한 — 건당 상한만으로는 반복 리딤을 막지 못한다 (CumulativeDrain.t.sol 참조)
    ERC20TransferAmountEnforcer constant TOTAL_BUDGET_ENFORCER =
        ERC20TransferAmountEnforcer(0x4cC2931c6dB25aAaA6360b802b7987f2A39eF559);

    /// @dev 도장을 보유하고 7702 코드가 심긴 데모 주인 EOA
    address constant OWNER = 0x7d558dEAf66985aE1358D96152EF1b7A28857a6C;

    uint256 constant PER_TX_CAP = 1_000e6;
    uint256 constant TOTAL_BUDGET = 100_000e6;

    address agent = makeAddr("liveAgent");
    address merchant = makeAddr("liveMerchant");

    uint256 ownerPk;

    /// @return 포크 + 주인 키가 모두 준비됐으면 true
    function _ready() internal returns (bool) {
        if (block.chainid != GIWA_SEPOLIA_CHAIN_ID) {
            vm.skip(true);
            return false;
        }
        ownerPk = vm.envOr("OWNER_PRIVATE_KEY", uint256(0));
        if (ownerPk == 0 || vm.addr(ownerPk) != OWNER) {
            vm.skip(true);
            return false;
        }
        return true;
    }

    function _caveats() internal pure returns (Caveat[] memory c_) {
        // 확정 순서와 동일한 상대 배치: 건당 → 총예산 → Dojang
        c_ = new Caveat[](3);
        c_[0] = Caveat({
            enforcer: address(PER_TX),
            terms: abi.encodePacked(address(TOKEN), PER_TX_CAP),
            args: hex""
        });
        c_[1] = Caveat({
            enforcer: address(TOTAL_BUDGET_ENFORCER),
            terms: abi.encodePacked(address(TOKEN), TOTAL_BUDGET),
            args: hex""
        });
        c_[2] = Caveat({
            enforcer: address(DOJANG),
            terms: abi.encode(address(GATE), address(REGISTRY), address(TOKEN), false),
            args: hex""
        });
    }

    function _signedDelegation() internal view returns (Delegation memory d_) {
        d_ = Delegation({
            delegate: agent,
            delegator: OWNER,
            authority: DELEGATION_MANAGER.ROOT_AUTHORITY(),
            caveats: _caveats(),
            salt: 0,
            signature: hex""
        });
        bytes32 typedDataHash_ = MessageHashUtils.toTypedDataHash(
            DELEGATION_MANAGER.getDomainHash(), EncoderLib._getDelegationHash(d_)
        );
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(ownerPk, typedDataHash_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }

    function _redeem(address redeemer, Delegation memory d_, address to, uint256 amount) internal {
        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = d_;

        bytes[] memory permissionContexts_ = new bytes[](1);
        permissionContexts_[0] = abi.encode(delegations_);

        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();

        bytes[] memory executionCallDatas_ = new bytes[](1);
        executionCallDatas_[0] = ExecutionLib.encodeSingle(
            address(TOKEN), 0, abi.encodeWithSelector(TOKEN.transfer.selector, to, amount)
        );

        vm.prank(redeemer);
        DELEGATION_MANAGER.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);
    }

    /// @notice 실배포 상태 점검 — 7702 코드, 도장, 배선
    function test_Fork_LiveDeploymentIsWired() public {
        if (!_ready()) return;

        assertEq(
            OWNER.code,
            bytes.concat(hex"ef0100", abi.encodePacked(DELEGATOR_IMPL)),
            "owner EOA should carry the 7702 designator on-chain"
        );
        assertTrue(GATE.isVerified(OWNER), "owner should hold a real Dojang stamp");
        assertEq(address(REGISTRY.gate()), address(GATE), "registry should point at the deployed gate");
        assertEq(TOKEN.decimals(), 6);
    }

    /// @notice 축약 사이클: 바인딩 → 위임 서명 → 에이전트 리딤 → 철회 후 차단
    function test_Fork_LiveDelegationCycle() public {
        if (!_ready()) return;

        // 1) 바인딩 (실도장 주인이므로 게이트를 통과한다)
        vm.prank(OWNER);
        REGISTRY.proposeBinding(agent);
        vm.prank(agent);
        REGISTRY.acceptBinding(OWNER);
        assertTrue(REGISTRY.isAccountableAgent(agent));

        // 2) 주인 EOA에 tKRW 확보 (배포자가 MINTER_ROLE 보유 — 데모와 동일 절차)
        address minter = 0xA53826D1959A254F10c2F96f8e7A0F1D8E520A26;
        vm.prank(minter);
        TOKEN.mint(OWNER, TOTAL_BUDGET);
        uint256 ownerBefore_ = TOKEN.balanceOf(OWNER);

        // 3) 위임 서명 + 에이전트 리딤 (일반 tx)
        Delegation memory d_ = _signedDelegation();
        _redeem(agent, d_, merchant, PER_TX_CAP);

        assertEq(TOKEN.balanceOf(merchant), PER_TX_CAP, "merchant should receive tKRW");
        assertEq(TOKEN.balanceOf(OWNER), ownerBefore_ - PER_TX_CAP, "spent directly from the owner EOA");

        // 4) 건당 상한 초과는 차단
        vm.expectRevert(
            abi.encodeWithSelector(
                JipsaPerTxCapEnforcer.PerTxCapExceeded.selector, PER_TX_CAP + 1, PER_TX_CAP
            )
        );
        _redeem(agent, d_, merchant, PER_TX_CAP + 1);

        // 5) 주인이 직접 철회하면 이후 리딤이 막힌다 (회수 단계 없음)
        vm.prank(OWNER);
        DELEGATION_MANAGER.disableDelegation(d_);

        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(agent, d_, merchant, PER_TX_CAP);

        // 자금은 계속 주인 소유
        assertEq(TOKEN.balanceOf(OWNER), ownerBefore_ - PER_TX_CAP);
    }
}
