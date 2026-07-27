// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EAS Attestation 구조체 (Ethereum Attestation Service 표준)
struct Attestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address recipient;
    address attester;
    bool revocable;
    bytes data;
}

/// @notice EAS 최소 인터페이스 — GIWA Sepolia: 0x4200000000000000000000000000000000000021
interface IEAS {
    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}
