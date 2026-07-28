// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";
import {CaveatEnforcer} from "delegation-framework/src/enforcers/CaveatEnforcer.sol";
import {ModeCode} from "delegation-framework/src/utils/Types.sol";
import {IVerifiedGate} from "../interfaces/IVerifiedGate.sol";
import {OwnerBindingRegistry} from "../OwnerBindingRegistry.sol";

/// @title DojangCaveatEnforcer
/// @notice JIPSA의 책임 귀속 계층을 위임 리딤 시점에 강제하는 caveat enforcer.
///
/// @dev 스톡 enforcer는 "얼마나 쓸 수 있는가"를 제한한다. 이 enforcer는
///      "누가 책임지는가"를 강제한다 — 리딤 시점에 세 가지를 확인한다.
///
///      1. 수신처가 Dojang 도장 보유자인지 (terms 플래그로 on/off)
///      2. 리딤하는 에이전트가 레지스트리상 **이 delegator에게** 바인딩되어 있는지
///      3. 주인(delegator)의 도장이 여전히 유효한지
///
///      2번이 핵심이다. "아무 검증된 주인에게든 묶여 있으면 통과"시키면 다른 주인의
///      에이전트가 이 위임을 리딤할 수 있다(PolicyAccount에서 고쳤던 결함과 동일 논리).
///
///      EIP-7702 모델에서 delegator는 7702 코드를 부여받은 **주인 EOA 자신**이다.
///      따라서 주인 주소를 얻기 위해 별도 계정 컨트랙트의 owner()를 조회할 필요가 없고,
///      `_delegator`를 그대로 주인으로 취급한다.
contract DojangCaveatEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    /// @dev IERC20.transfer.selector. OZ를 import하면 우리 OZ(^0.8.24)가
    ///      이 파일의 0.8.23 컴파일 단위로 끌려오므로 상수로 둔다.
    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;

    error InvalidTermsLength(uint256 length);
    error InvalidExecutionLength(uint256 length);
    error InvalidContract(address target, address expected);
    error InvalidMethod(bytes4 selector);
    error RecipientNotVerified(address to);
    error AgentNotBound(address redeemer, address delegator);
    error OwnerNotVerified(address owner);

    /// @param _terms `abi.encode(IVerifiedGate gate, OwnerBindingRegistry registry, address token, bool verifiedRecipientOnly)`
    /// @param _delegator 위임한 주인 EOA (7702 코드 보유)
    /// @param _redeemer 리딤을 시도하는 에이전트
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32,
        address _delegator,
        address _redeemer
    )
        public
        view
        override
        onlySingleCallTypeMode(_mode)
        onlyDefaultExecutionMode(_mode)
    {
        // 상태를 쓰지 않으므로 view로 좁힌다 (오버라이드에서 더 엄격한 mutability는 허용).
        // beforeHook은 인자만 넘기고 지역변수를 두지 않는다 (stack too deep 회피)
        _enforce(_terms, _executionCallData, _delegator, _redeemer);
    }

    /// @dev 수신처 도장 · 바인딩 일치 · 주인 도장을 순서대로 확인한다.
    ///      calldata 디코딩 변수는 스코프 블록에 가둬 수명을 줄인다 (stack too deep 회피).
    function _enforce(
        bytes calldata _terms,
        bytes calldata _executionCallData,
        address _delegator,
        address _redeemer
    )
        internal
        view
    {
        (IVerifiedGate gate_, OwnerBindingRegistry registry_, address token_, bool verifiedRecipientOnly_) =
            getTermsInfo(_terms);

        {
            (address target_,, bytes calldata callData_) = _executionCallData.decodeSingle();

            if (callData_.length != 68) revert InvalidExecutionLength(callData_.length);
            if (bytes4(callData_[0:4]) != TRANSFER_SELECTOR) revert InvalidMethod(bytes4(callData_[0:4]));
            if (target_ != token_) revert InvalidContract(target_, token_);

            // 1. 수신처 도장 (프롬프트 인젝션으로 임의 주소에 송금하려는 시도 차단)
            if (verifiedRecipientOnly_) {
                address to_ = address(bytes20(callData_[16:36]));
                if (!gate_.isVerified(to_)) revert RecipientNotVerified(to_);
            }
        }

        // 2. 바인딩 일치 — 이 주인에게 귀속된 에이전트만 리딤할 수 있다
        if (registry_.ownerOf(_redeemer) != _delegator) revert AgentNotBound(_redeemer, _delegator);

        // 3. 주인 도장 유효성 재확인 (KYC 무효화 시 즉시 정지)
        if (!gate_.isVerified(_delegator)) revert OwnerNotVerified(_delegator);
    }

    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (
            IVerifiedGate gate_,
            OwnerBindingRegistry registry_,
            address token_,
            bool verifiedRecipientOnly_
        )
    {
        if (_terms.length != 128) revert InvalidTermsLength(_terms.length);
        // 튜플 할당에서 새 선언과 기존 반환 변수를 섞을 수 없어 따로 받는다
        (address gateAddr_, address registryAddr_, address tokenAddr_, bool onlyVerified_) =
            abi.decode(_terms, (address, address, address, bool));
        gate_ = IVerifiedGate(gateAddr_);
        registry_ = OwnerBindingRegistry(registryAddr_);
        token_ = tokenAddr_;
        verifiedRecipientOnly_ = onlyVerified_;
    }
}
