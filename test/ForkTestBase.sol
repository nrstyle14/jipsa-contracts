// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";

/// @notice GIWA Sepolia 포크 테스트 공통 베이스.
///         실제 Dojang 도장을 조회하므로 포크 없이는 실행할 수 없다.
/// 실행:
///   forge test --fork-url https://sepolia-rpc.giwa.io
/// 포크 없이 `forge test`로 돌리면 chainid 불일치로 자동 skip된다.
abstract contract ForkTestBase is Test {
    uint256 internal constant GIWA_SEPOLIA_CHAIN_ID = 91342;

    address internal constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 internal constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 internal constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @dev TESTNET FAUCET 도장을 보유한 실제 주소 (EOA)
    address internal constant VERIFIED_SUBJECT = 0x4850e00e93f6eF718856b9025Fc0189b9F3c8aF7;
    address internal constant UNVERIFIED_SUBJECT = 0x000000000000000000000000000000000000dEaD;

    /// @notice 포크 환경이 아니면 테스트를 skip 처리한다.
    /// @return 포크 환경이면 true (테스트를 계속 진행해도 되는지 여부)
    function _onGiwaFork() internal returns (bool) {
        if (block.chainid != GIWA_SEPOLIA_CHAIN_ID) {
            vm.skip(true);
            return false;
        }
        return true;
    }

    /// @notice 신뢰 attesterId 두 개를 등록한 실전 게이트 배포
    function _deployGate() internal returns (DojangVerifiedGate) {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = ATTESTER_ID_FAUCET;
        ids[1] = ATTESTER_ID_UPBIT;
        return new DojangVerifiedGate(DOJANG_SCROLL, ids);
    }
}
