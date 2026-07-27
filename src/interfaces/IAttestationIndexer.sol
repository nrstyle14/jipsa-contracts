// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Dojang AttestationIndexer — GIWA Sepolia: 0x9C9Bf29880448aB39795a11b669e22A0f1d790ec
/// @dev ⚠️ TODO: 함수 시그니처는 추정치입니다.
///      https://github.com/giwa-io/dojang 에서 실제 ABI를 확인하고 교체하세요.
///      DojangScroll(0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9)에
///      더 간편한 조회 함수가 있다면 그쪽을 사용하는 것을 권장합니다.
interface IAttestationIndexer {
    /// @notice recipient + schema 기준 최신 attestation UID 조회 (추정 시그니처)
    function getAttestationUid(address recipient, bytes32 schemaUid) external view returns (bytes32);
}
