// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";
import {MockVerifiedGate} from "../src/gates/MockVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";
import {PolicyAccount} from "../src/PolicyAccount.sol";
import {IVerifiedGate} from "../src/interfaces/IVerifiedGate.sol";

/// @notice GIWA Sepolia 배포 스크립트
/// 사용:
///   export PRIVATE_KEY=0x...
///   forge script script/Deploy.s.sol --rpc-url giwa_sepolia --broadcast
contract Deploy is Script {
    // GIWA Sepolia — Dojang (https://docs.giwa.io/giwa-ecosystem/dojang/contracts)
    address constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @dev true면 MockVerifiedGate 배포 (Verified Address 발급 불가 시 플랜 B)
    bool constant USE_MOCK_GATE = false;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        IVerifiedGate gate;
        if (USE_MOCK_GATE) {
            MockVerifiedGate mock = new MockVerifiedGate();
            gate = mock;
            console.log("MockVerifiedGate:", address(mock));
        } else {
            bytes32[] memory attesterIds = new bytes32[](2);
            attesterIds[0] = ATTESTER_ID_FAUCET;
            attesterIds[1] = ATTESTER_ID_UPBIT;
            DojangVerifiedGate dojang = new DojangVerifiedGate(DOJANG_SCROLL, attesterIds);
            gate = dojang;
            console.log("DojangVerifiedGate:", address(dojang));
        }

        OwnerBindingRegistry registry = new OwnerBindingRegistry(gate);
        console.log("OwnerBindingRegistry:", address(registry));

        vm.stopBroadcast();

        // PolicyAccount는 데모 시나리오에서 주인 지갑으로 생성:
        //   new PolicyAccount(owner, agent, registry, gate, policy)
        // 데모 정책 예시: totalBudget 0.1 ether, perTxCap 0.001 ether,
        //   dailyCap 0.01 ether, validUntil now+7d, verifiedRecipientOnly false
    }
}
