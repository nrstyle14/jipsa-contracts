// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";

/// @notice GIWA Sepolia 배포 스크립트
/// 사용:
///   export PRIVATE_KEY=0x...
///   forge script script/Deploy.s.sol --rpc-url giwa_sepolia --broadcast
///
/// @dev MockVerifiedGate는 테스트 전용이므로 배포 스크립트에서 다루지 않는다.
///      실제 Dojang 도장 발급이 확인되어 항상 DojangVerifiedGate를 배포한다.
contract Deploy is Script {
    // GIWA Sepolia — Dojang (https://docs.giwa.io/giwa-ecosystem/dojang/contracts)
    address constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @notice 배포자에게 민팅할 데모용 물량 (100,000 tKRW)
    uint256 constant DEMO_MINT_AMOUNT = 100_000e6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        JipsaSettlementToken token = new JipsaSettlementToken();
        console.log("JipsaSettlementToken (tKRW):", address(token));

        bytes32[] memory attesterIds = new bytes32[](2);
        attesterIds[0] = ATTESTER_ID_FAUCET;
        attesterIds[1] = ATTESTER_ID_UPBIT;
        DojangVerifiedGate gate = new DojangVerifiedGate(DOJANG_SCROLL, attesterIds);
        console.log("DojangVerifiedGate:", address(gate));

        OwnerBindingRegistry registry = new OwnerBindingRegistry(gate);
        console.log("OwnerBindingRegistry:", address(registry));

        token.mint(deployer, DEMO_MINT_AMOUNT);
        console.log("Minted tKRW to deployer:", deployer, DEMO_MINT_AMOUNT);

        vm.stopBroadcast();

        // PolicyAccount는 데모 시나리오에서 주인 지갑으로 생성:
        //   new PolicyAccount(owner, agent, registry, gate, token, policy)
        // 자금 투입은 주인이 tKRW를 계정 주소로 직접 transfer (approve 불필요).
        // 데모 정책 예시 (tKRW 최소단위, 6 decimals):
        //   totalBudget 100_000e6, perTxCap 1_000e6, dailyCap 10_000e6,
        //   validUntil now+7d, verifiedRecipientOnly false
    }
}
