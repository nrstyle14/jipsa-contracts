// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ForkTestBase} from "./ForkTestBase.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";

/// @notice GIWA Sepolia 포크 테스트 — 실제 DojangScroll 도장을 조회한다.
/// 실행:
///   forge test --match-path test/DojangVerifiedGate.fork.t.sol \
///     --fork-url https://sepolia-rpc.giwa.io
contract DojangVerifiedGateForkTest is ForkTestBase {
    function test_Fork_VerifiedSubjectPassesGate() public {
        if (!_onGiwaFork()) return;

        DojangVerifiedGate gate = _deployGate();

        assertTrue(gate.isVerified(VERIFIED_SUBJECT), "verified subject should pass the gate");
        assertFalse(gate.isVerified(UNVERIFIED_SUBJECT), "unverified subject should fail the gate");
    }
}
