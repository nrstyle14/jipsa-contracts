// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {ModeLib} from "@erc7579/lib/ModeLib.sol";
import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";
import {EncoderLib} from "delegation-framework/src/libraries/EncoderLib.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/src/utils/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice `packages/delegation`의 TypeScript 인코딩을 교차 검증하기 위한 기대값 출력.
///
/// 실행 (체인 접속 불필요):
///   forge script script/PrintCaveats.s.sol
///
/// @dev 출력값을 packages/delegation/test/encoding.test.ts 의 기대 상수와 비교한다.
///      인코딩이 어긋나면 TS 테스트가 깨진다 — 스냅샷이 아니라 Solidity 기준 교차 검증이다.
contract PrintCaveats is Script {
    // 고정 입력 (TS 테스트와 동일해야 함)
    address constant TOKEN = 0x1E743C166FaeeEe5b840A471a6760535AE4076B0;
    address constant GATE = 0xD13aE574E53F2D14F71411383CcEeC9c16529fc3;
    address constant REGISTRY = 0x6ef7F805fBCaA49cbfc11C861E2EC051549433C7;
    address constant AGENT = 0xA8aa05641CE239F5Ceb3dFbd8EF5955D97CEBFdA;
    address constant OWNER = 0x7d558dEAf66985aE1358D96152EF1b7A28857a6C;
    address constant MERCHANT = 0x49af607820B112Aa35097D0eb9B8AfE2235C181F;

    address constant ALLOWED_TARGETS = 0x977156e9b7Ae812C542FDbE3eEa0b93Fe87C0371;
    address constant ALLOWED_METHODS = 0x816E3D68470E84Db37799ECA14dc9EBD86b37591;
    address constant TIMESTAMP_ENFORCER = 0x972298257A69792B0219900D8A2C9DAeC8094cC6;
    address constant PER_TX_ENFORCER = 0xdea5DF3357e0EEf6A841d3639d115eb57b42B642;
    address constant TOTAL_BUDGET_ENFORCER = 0x4cC2931c6dB25aAaA6360b802b7987f2A39eF559;
    address constant PERIOD_ENFORCER = 0x73e8aEF3aD187524FD44B8f9b5B700689FE41071;
    address constant DOJANG_ENFORCER = 0x8C9c8437C27003f3d86F438c7147668d9cC5948C;

    uint256 constant TOTAL_BUDGET = 5_000e6;
    uint256 constant PER_TX_CAP = 50e6;
    uint256 constant DAILY_CAP = 500e6;
    uint256 constant VALID_UNTIL = 1_800_000_000;
    uint256 constant START_DATE = 1_790_000_000;
    uint256 constant SALT = 7;
    uint256 constant PAY_AMOUNT = 2e6;

    function run() external pure {
        console.log("--- terms ---");
        console.log("allowedTargets :", vm.toString(abi.encodePacked(TOKEN)));
        console.log("allowedMethods :", vm.toString(abi.encodePacked(IERC20.transfer.selector)));
        // unix 초의 uint128 축소는 안전하다
        // forge-lint: disable-next-line(unsafe-typecast)
        console.log("timestamp      :", vm.toString(abi.encodePacked(uint128(0), uint128(VALID_UNTIL))));
        console.log("perTxCap       :", vm.toString(abi.encodePacked(TOKEN, PER_TX_CAP)));
        console.log("totalBudget    :", vm.toString(abi.encodePacked(TOKEN, TOTAL_BUDGET)));
        console.log(
            "periodTransfer :",
            vm.toString(abi.encodePacked(TOKEN, DAILY_CAP, uint256(86400), START_DATE))
        );
        console.log("dojang         :", vm.toString(abi.encode(GATE, REGISTRY, TOKEN, true)));

        console.log("--- mode / execution ---");
        console.log("modeSimpleSingle:", vm.toString(ModeCode.unwrap(ModeLib.encodeSimpleSingle())));
        console.log(
            "execution       :",
            vm.toString(
                ExecutionLib.encodeSingle(
                    TOKEN,
                    0,
                    abi.encodeWithSelector(IERC20.transfer.selector, MERCHANT, PAY_AMOUNT)
                )
            )
        );

        console.log("--- delegation hash ---");
        console.log("delegationHash  :", vm.toString(EncoderLib._getDelegationHash(_delegation())));
    }

    function _delegation() internal pure returns (Delegation memory) {
        Caveat[] memory c_ = new Caveat[](7);
        c_[0] = Caveat(ALLOWED_TARGETS, abi.encodePacked(TOKEN), hex"");
        c_[1] = Caveat(ALLOWED_METHODS, abi.encodePacked(IERC20.transfer.selector), hex"");
        // forge-lint: disable-next-line(unsafe-typecast)
        c_[2] = Caveat(TIMESTAMP_ENFORCER, abi.encodePacked(uint128(0), uint128(VALID_UNTIL)), hex"");
        c_[3] = Caveat(PER_TX_ENFORCER, abi.encodePacked(TOKEN, PER_TX_CAP), hex"");
        c_[4] = Caveat(TOTAL_BUDGET_ENFORCER, abi.encodePacked(TOKEN, TOTAL_BUDGET), hex"");
        c_[5] = Caveat(
            PERIOD_ENFORCER, abi.encodePacked(TOKEN, DAILY_CAP, uint256(86400), START_DATE), hex""
        );
        c_[6] = Caveat(DOJANG_ENFORCER, abi.encode(GATE, REGISTRY, TOKEN, true), hex"");

        return Delegation({
            delegate: AGENT,
            delegator: OWNER,
            authority: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff,
            caveats: c_,
            salt: SALT,
            signature: hex""
        });
    }
}
