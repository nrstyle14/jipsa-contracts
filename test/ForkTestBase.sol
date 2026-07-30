// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {DojangVerifiedGate} from "../src/gates/DojangVerifiedGate.sol";

/// @notice GIWA Sepolia 포크 테스트 공통 베이스.
///         실제 Dojang 도장을 조회하므로 포크 없이는 실행할 수 없다.
/// 실행:
///   FOUNDRY_PROFILE=fork forge test        (RPC·블록은 foundry.toml에 박혀 있다)
/// 포크 없이 `forge test`로 돌리면 chainid 불일치로 자동 skip된다.
abstract contract ForkTestBase is Test {
    uint256 internal constant GIWA_SEPOLIA_CHAIN_ID = 91342;

    /// @notice 포크 블록의 하한.
    ///
    /// @dev 포크 테스트는 **체인에 이미 존재하는 데모 셋업**에 의존한다 — 주인 EOA의
    ///      Dojang 도장과 7702 designator다. 그 셋업 이전 블록으로 포크하면 도장 조회가
    ///      false를, `cast code`가 `0x`를 돌려주므로 테스트가 깨진다. 실측으로 31,869,189
    ///      에서는 둘 다 없고 31,900,000 에서는 둘 다 있다.
    ///
    ///      한때 README가 31,869,189을 권했고 코드가 이 값을 참조하지 않아 조용히 깨진
    ///      상태로 남아 있었다. 이 하한은 그 실패를 "왜 깨졌는지 말해주는 실패"로 바꾼다.
    uint256 internal constant MIN_FORK_BLOCK = 31_900_000;

    address internal constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;
    bytes32 internal constant ATTESTER_ID_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678; // TESTNET FAUCET
    bytes32 internal constant ATTESTER_ID_UPBIT =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034; // UPBIT KOREA

    /// @dev TESTNET FAUCET 도장을 보유한 실제 주소 (EOA)
    address internal constant VERIFIED_SUBJECT = 0x4850e00e93f6eF718856b9025Fc0189b9F3c8aF7;
    address internal constant UNVERIFIED_SUBJECT = 0x000000000000000000000000000000000000dEaD;

    /// @notice 포크 환경이 아니면 skip, 포크지만 블록이 너무 낮으면 **실패**시킨다.
    ///
    /// @dev 너무 낮은 블록을 skip으로 넘기지 않는 이유: 포크를 붙이고 돌렸는데 조용히
    ///      건너뛰면 검증한 줄 알고 통과로 읽힌다. 여기서는 무엇이 잘못됐는지 말하고 멈춘다.
    /// @return 포크 환경이면 true (테스트를 계속 진행해도 되는지 여부)
    function _onGiwaFork() internal returns (bool) {
        if (block.chainid != GIWA_SEPOLIA_CHAIN_ID) {
            vm.skip(true);
            return false;
        }
        if (block.number < MIN_FORK_BLOCK) {
            revert(
                string.concat(
                    "fork block ",
                    vm.toString(block.number),
                    " predates the demo setup (owner stamp + 7702 designator); need >= ",
                    vm.toString(MIN_FORK_BLOCK),
                    ". Run: FOUNDRY_PROFILE=fork forge test"
                )
            );
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
