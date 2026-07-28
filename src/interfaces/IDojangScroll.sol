// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Dojang Scroll — GIWA Sepolia: 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9
/// @dev EAS/Indexer를 직접 조회할 필요 없이 attesterId 단위로 검증 여부를 알려준다.
interface IDojangScroll {
    /// @param subject 검증 대상 주소
    /// @param attesterId 발급 기관 식별자 (예: UPBIT KOREA, TESTNET FAUCET)
    /// @return 해당 기관이 발급한 유효한 Verified Address 도장을 보유하면 true
    function isVerified(address subject, bytes32 attesterId) external view returns (bool);
}
