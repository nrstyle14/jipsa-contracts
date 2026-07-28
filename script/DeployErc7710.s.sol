// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";

import {DelegationManager} from "delegation-framework/src/DelegationManager.sol";
import {IDelegationManager} from "delegation-framework/src/interfaces/IDelegationManager.sol";
import {IEntryPoint} from "@account-abstraction/interfaces/IEntryPoint.sol";
import {EIP7702StatelessDeleGator} from "delegation-framework/src/EIP7702/EIP7702StatelessDeleGator.sol";
import {AllowedTargetsEnforcer} from "delegation-framework/src/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/src/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20TransferAmountEnforcer} from "delegation-framework/src/enforcers/ERC20TransferAmountEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/src/enforcers/TimestampEnforcer.sol";

import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";
import {DojangCaveatEnforcer} from "../src/enforcers/DojangCaveatEnforcer.sol";
import {JipsaPerTxCapEnforcer} from "../src/enforcers/JipsaPerTxCapEnforcer.sol";

/// @notice GIWA Sepolia ERC-7710 스택 배포.
/// 사용:
///   forge script script/DeployErc7710.s.sol --rpc-url giwa_sepolia --broadcast
///
/// 이미 배포된 토큰·게이트·레지스트리가 있으면 환경변수로 넘겨 재사용한다:
///   TOKEN_ADDRESS / GATE_ADDRESS / REGISTRY_ADDRESS
///
/// @dev DelegationManager와 EIP7702StatelessDeleGator는 감사 태그 v1.3.0 원본을
///      그대로 배포한다 (커스텀 계정 코드 0줄).
contract DeployErc7710 is Script {
    // GIWA Sepolia — Dojang
    address constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @dev 프레임워크 v1.3.0은 account-abstraction v0.7.0을 쓴다 → EntryPoint v0.7.
    ///      GIWA Sepolia에 배포되어 있음을 확인했다.
    address constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    uint256 constant DEMO_MINT_AMOUNT = 100_000e6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        // ---------- JIPSA 기존 스택 (없으면 배포) ----------
        JipsaSettlementToken token = JipsaSettlementToken(vm.envOr("TOKEN_ADDRESS", address(0)));
        if (address(token) == address(0)) {
            token = new JipsaSettlementToken();
            token.mint(deployer, DEMO_MINT_AMOUNT);
        }
        console.log("JipsaSettlementToken (tKRW):", address(token));

        DojangVerifiedGate gate = DojangVerifiedGate(vm.envOr("GATE_ADDRESS", address(0)));
        if (address(gate) == address(0)) {
            bytes32[] memory attesterIds = new bytes32[](2);
            attesterIds[0] = ATTESTER_ID_FAUCET;
            attesterIds[1] = ATTESTER_ID_UPBIT;
            gate = new DojangVerifiedGate(DOJANG_SCROLL, attesterIds);
        }
        console.log("DojangVerifiedGate:        ", address(gate));

        OwnerBindingRegistry registry = OwnerBindingRegistry(vm.envOr("REGISTRY_ADDRESS", address(0)));
        if (address(registry) == address(0)) {
            registry = new OwnerBindingRegistry(gate);
        }
        console.log("OwnerBindingRegistry:      ", address(registry));

        // ---------- 프레임워크 원본 (감사 태그 v1.3.0) ----------
        DelegationManager delegationManager = new DelegationManager(deployer);
        console.log("DelegationManager:         ", address(delegationManager));

        EIP7702StatelessDeleGator deleGatorImpl = new EIP7702StatelessDeleGator(
            IDelegationManager(address(delegationManager)), IEntryPoint(ENTRY_POINT_V07)
        );
        console.log("EIP7702StatelessDeleGator: ", address(deleGatorImpl));

        // ---------- 스톡 enforcer ----------
        console.log("AllowedTargetsEnforcer:    ", address(new AllowedTargetsEnforcer()));
        console.log("AllowedMethodsEnforcer:    ", address(new AllowedMethodsEnforcer()));
        console.log("ERC20TransferAmount:       ", address(new ERC20TransferAmountEnforcer()));
        console.log("ERC20PeriodTransfer:       ", address(new ERC20PeriodTransferEnforcer()));
        console.log("TimestampEnforcer:         ", address(new TimestampEnforcer()));

        // ---------- 커스텀 enforcer (JIPSA 고유) ----------
        console.log("DojangCaveatEnforcer:      ", address(new DojangCaveatEnforcer()));
        console.log("JipsaPerTxCapEnforcer:     ", address(new JipsaPerTxCapEnforcer()));

        vm.stopBroadcast();

        console.log("");
        console.log("Next: attach 7702 code to the owner EOA");
        console.log("  export DELEGATOR_IMPL=<EIP7702StatelessDeleGator address above>");
        console.log("  forge script script/Setup7702.s.sol --rpc-url giwa_sepolia --broadcast");
    }
}
