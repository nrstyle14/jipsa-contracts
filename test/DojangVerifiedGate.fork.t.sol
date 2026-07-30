// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ForkTestBase} from "./ForkTestBase.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";

/// @notice GIWA Sepolia 포크 테스트 — 실제 DojangScroll 도장을 조회한다.
/// 실행:
///   FOUNDRY_PROFILE=fork forge test --match-path test/DojangVerifiedGate.fork.t.sol
contract DojangVerifiedGateForkTest is ForkTestBase {
    function test_Fork_VerifiedSubjectPassesGate() public {
        if (!_onGiwaFork()) return;

        DojangVerifiedGate gate = _deployGate();

        assertTrue(gate.isVerified(VERIFIED_SUBJECT), "verified subject should pass the gate");
        assertFalse(gate.isVerified(UNVERIFIED_SUBJECT), "unverified subject should fail the gate");
    }
}
