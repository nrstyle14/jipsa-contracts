// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";
import {CaveatEnforcer} from "delegation-framework/src/enforcers/CaveatEnforcer.sol";
import {ModeCode} from "delegation-framework/src/utils/Types.sol";

/// @title JipsaPerTxCapEnforcer
/// @notice 리딤 1건당 전송 금액 상한을 강제한다.
///
/// @dev v1.3.0 스톡 enforcer에는 "건당" 상한이 없다. `ERC20TransferAmountEnforcer`는
///      누적 총액, `ERC20PeriodTransferEnforcer`는 기간 합계, `ValueLteEnforcer`는
///      네이티브 value 기준이라 어느 것도 1회 전송액을 제한하지 않는다. 그래서 추가한다.
///      상태를 두지 않으므로 delegationHash별 누적 관리가 필요 없다.
contract JipsaPerTxCapEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    /// @dev IERC20.transfer.selector. OZ를 import하면 우리 OZ(^0.8.24)가
    ///      이 파일의 0.8.23 컴파일 단위로 끌려오므로 상수로 둔다.
    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;

    error InvalidTermsLength(uint256 length);
    error InvalidExecutionLength(uint256 length);
    error InvalidContract(address target, address expected);
    error InvalidMethod(bytes4 selector);
    error PerTxCapExceeded(uint256 amount, uint256 cap);

    /// @param _terms `abi.encodePacked(address token, uint256 cap)` (52 bytes)
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32,
        address,
        address
    )
        public
        pure
        override
        onlySingleCallTypeMode(_mode)
        onlyDefaultExecutionMode(_mode)
    {
        // 상태를 읽지도 쓰지도 않으므로 pure로 좁힌다
        (address token_, uint256 cap_) = getTermsInfo(_terms);
        (address target_,, bytes calldata callData_) = _executionCallData.decodeSingle();

        if (callData_.length != 68) revert InvalidExecutionLength(callData_.length);
        if (target_ != token_) revert InvalidContract(target_, token_);

        bytes4 selector_ = bytes4(callData_[0:4]);
        if (selector_ != TRANSFER_SELECTOR) revert InvalidMethod(selector_);

        uint256 amount_ = uint256(bytes32(callData_[36:68]));
        if (amount_ > cap_) revert PerTxCapExceeded(amount_, cap_);
    }

    /// @return token_ 상한을 적용할 토큰 주소
    /// @return cap_ 건당 상한 (토큰 최소단위)
    function getTermsInfo(bytes calldata _terms) public pure returns (address token_, uint256 cap_) {
        if (_terms.length != 52) revert InvalidTermsLength(_terms.length);
        token_ = address(bytes20(_terms[:20]));
        cap_ = uint256(bytes32(_terms[20:]));
    }
}
