// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifiedGate} from "../interfaces/IVerifiedGate.sol";
import {IEAS, Attestation} from "../interfaces/IEAS.sol";
import {IAttestationIndexer} from "../interfaces/IAttestationIndexer.sol";

/// @title DojangVerifiedGate
/// @notice Dojang Verified Address attestation을 검증하는 게이트.
///         GIWA Sepolia 기준 주소는 README 참조.
contract DojangVerifiedGate is IVerifiedGate {
    IEAS public immutable eas;
    IAttestationIndexer public immutable indexer;
    /// @notice Verified Address 스키마 UID
    bytes32 public immutable schemaUid;

    /// @notice 신뢰하는 attester 목록 (UPBIT KOREA, TESTNET FAUCET 등)
    mapping(address => bool) public trustedAttester;
    address public immutable admin;

    event TrustedAttesterSet(address indexed attester, bool trusted);

    error NotAdmin();

    constructor(address eas_, address indexer_, bytes32 schemaUid_, address[] memory attesters) {
        eas = IEAS(eas_);
        indexer = IAttestationIndexer(indexer_);
        schemaUid = schemaUid_;
        admin = msg.sender;
        for (uint256 i = 0; i < attesters.length; i++) {
            trustedAttester[attesters[i]] = true;
            emit TrustedAttesterSet(attesters[i], true);
        }
    }

    function setTrustedAttester(address attester, bool trusted) external {
        if (msg.sender != admin) revert NotAdmin();
        trustedAttester[attester] = trusted;
        emit TrustedAttesterSet(attester, trusted);
    }

    /// @inheritdoc IVerifiedGate
    function isVerified(address subject) external view returns (bool) {
        // ⚠️ TODO: Indexer 실제 ABI 확인 후 조회 방식 교체 (README 참조)
        bytes32 uid = indexer.getAttestationUid(subject, schemaUid);
        if (uid == bytes32(0)) return false;

        Attestation memory att = eas.getAttestation(uid);

        if (att.schema != schemaUid) return false;
        if (att.recipient != subject) return false;
        if (!trustedAttester[att.attester]) return false;
        if (att.revocationTime != 0) return false;
        if (att.expirationTime != 0 && att.expirationTime <= block.timestamp) return false;

        // 스키마 콘텐츠: `bool isVerified`
        if (att.data.length < 32) return false;
        bool verified = abi.decode(att.data, (bool));
        return verified;
    }
}
