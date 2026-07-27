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
    address constant EAS = 0x4200000000000000000000000000000000000021;
    address constant INDEXER = 0x9C9Bf29880448aB39795a11b669e22A0f1d790ec;
    bytes32 constant VERIFIED_ADDRESS_SCHEMA_UID =
        0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08;
    address constant ATTESTER_UPBIT = 0x4097bF3Cb731AEB3E501b910B33B2aF9Fa68E388;
    address constant ATTESTER_FAUCET = 0x63CCe2b569A7bC35895ee24306c1512fefc06121;

    /// @dev true면 MockVerifiedGate 배포 (Verified Address 발급 불가 시 플랜 B)
    bool constant USE_MOCK_GATE = true; // TODO: Dojang 발급 확인 후 false로

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        IVerifiedGate gate;
        if (USE_MOCK_GATE) {
            MockVerifiedGate mock = new MockVerifiedGate();
            gate = mock;
            console.log("MockVerifiedGate:", address(mock));
        } else {
            address[] memory attesters = new address[](2);
            attesters[0] = ATTESTER_UPBIT;
            attesters[1] = ATTESTER_FAUCET;
            DojangVerifiedGate dojang =
                new DojangVerifiedGate(EAS, INDEXER, VERIFIED_ADDRESS_SCHEMA_UID, attesters);
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
