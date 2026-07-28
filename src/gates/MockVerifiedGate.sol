// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IVerifiedGate} from "../interfaces/IVerifiedGate.sol";

/// @title MockVerifiedGate
/// @notice 테스트/데모용 게이트 (플랜 B).
///         테스트넷에서 Verified Address 발급이 불가할 경우 사용하고,
///         제출 문서에 "메인넷에서 DojangVerifiedGate로 교체"를 명시할 것.
contract MockVerifiedGate is IVerifiedGate {
    address public immutable admin;
    mapping(address => bool) private _verified;

    event VerifiedSet(address indexed subject, bool verified);

    error NotAdmin();

    constructor() {
        admin = msg.sender;
    }

    function setVerified(address subject, bool verified) external {
        if (msg.sender != admin) revert NotAdmin();
        _verified[subject] = verified;
        emit VerifiedSet(subject, verified);
    }

    function isVerified(address subject) external view returns (bool) {
        return _verified[subject];
    }
}
