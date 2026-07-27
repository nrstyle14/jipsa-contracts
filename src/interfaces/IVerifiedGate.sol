// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice 신원 검증 게이트 추상화.
///         실전은 DojangVerifiedGate, 데모/테스트는 MockVerifiedGate로 교체 가능.
interface IVerifiedGate {
    /// @return subject가 유효한 Verified Address attestation을 보유하면 true
    function isVerified(address subject) external view returns (bool);
}
