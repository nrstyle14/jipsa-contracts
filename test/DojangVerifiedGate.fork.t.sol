// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";

/// @notice GIWA Sepolia 포크 테스트 — 실제 DojangScroll 도장을 조회한다.
/// 실행:
///   forge test --match-path test/DojangVerifiedGate.fork.t.sol \
///     --fork-url https://sepolia-rpc.giwa.io
/// 포크 없이 `forge test`로 돌리면 chainid 불일치로 자동 skip된다.
contract DojangVerifiedGateForkTest is Test {
    uint256 constant GIWA_SEPOLIA_CHAIN_ID = 91342;

    address constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @dev TESTNET FAUCET 도장을 보유한 실제 주소
    address constant VERIFIED_SUBJECT = 0x4850e00e93f6eF718856b9025Fc0189b9F3c8aF7;
    address constant UNVERIFIED_SUBJECT = 0x000000000000000000000000000000000000dEaD;

    function test_Fork_VerifiedSubjectPassesGate() public {
        if (block.chainid != GIWA_SEPOLIA_CHAIN_ID) {
            vm.skip(true);
            return;
        }

        bytes32[] memory attesterIds = new bytes32[](2);
        attesterIds[0] = ATTESTER_ID_FAUCET;
        attesterIds[1] = ATTESTER_ID_UPBIT;
        DojangVerifiedGate gate = new DojangVerifiedGate(DOJANG_SCROLL, attesterIds);

        assertTrue(gate.isVerified(VERIFIED_SUBJECT), "verified subject should pass the gate");
        assertFalse(gate.isVerified(UNVERIFIED_SUBJECT), "unverified subject should fail the gate");
    }
}
