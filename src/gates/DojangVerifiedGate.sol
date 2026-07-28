// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifiedGate} from "../interfaces/IVerifiedGate.sol";
import {IDojangScroll} from "../interfaces/IDojangScroll.sol";

/// @title DojangVerifiedGate
/// @notice DojangScroll의 isVerified(address,bytes32)로 Verified Address 도장을 검증하는 게이트.
///         신뢰하는 attesterId를 순회하며 하나라도 true면 통과.
///         GIWA Sepolia 기준 주소는 README 참조.
contract DojangVerifiedGate is IVerifiedGate {
    IDojangScroll public immutable scroll;
    address public immutable admin;

    /// @notice 신뢰하는 attesterId 목록 (UPBIT KOREA, TESTNET FAUCET 등)
    bytes32[] private _attesterIds;
    /// @notice attesterId => _attesterIds 내 인덱스 + 1 (0이면 미등록)
    mapping(bytes32 => uint256) private _attesterIdIndex;

    event AttesterIdSet(bytes32 indexed attesterId, bool trusted);

    error NotAdmin();
    error NoAttesterIds();
    error ZeroAttesterId();

    constructor(address scroll_, bytes32[] memory attesterIds_) {
        if (attesterIds_.length == 0) revert NoAttesterIds();
        scroll = IDojangScroll(scroll_);
        admin = msg.sender;
        for (uint256 i = 0; i < attesterIds_.length; i++) {
            _setAttesterId(attesterIds_[i], true);
        }
    }

    /// @notice 신뢰 attesterId 추가/제거. 이미 반영된 상태면 no-op.
    function setAttesterId(bytes32 attesterId, bool trusted) external {
        if (msg.sender != admin) revert NotAdmin();
        _setAttesterId(attesterId, trusted);
    }

    /// @return 현재 신뢰하는 attesterId 전체 목록
    function attesterIds() external view returns (bytes32[] memory) {
        return _attesterIds;
    }

    function isTrustedAttesterId(bytes32 attesterId) external view returns (bool) {
        return _attesterIdIndex[attesterId] != 0;
    }

    /// @inheritdoc IVerifiedGate
    function isVerified(address subject) external view returns (bool) {
        uint256 len = _attesterIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (scroll.isVerified(subject, _attesterIds[i])) return true;
        }
        return false;
    }

    function _setAttesterId(bytes32 attesterId, bool trusted) private {
        if (attesterId == bytes32(0)) revert ZeroAttesterId();
        uint256 indexPlusOne = _attesterIdIndex[attesterId];

        if (trusted) {
            if (indexPlusOne != 0) return;
            _attesterIds.push(attesterId);
            _attesterIdIndex[attesterId] = _attesterIds.length;
        } else {
            if (indexPlusOne == 0) return;
            uint256 last = _attesterIds.length - 1;
            uint256 index = indexPlusOne - 1;
            if (index != last) {
                bytes32 moved = _attesterIds[last];
                _attesterIds[index] = moved;
                _attesterIdIndex[moved] = indexPlusOne;
            }
            _attesterIds.pop();
            delete _attesterIdIndex[attesterId];
        }

        emit AttesterIdSet(attesterId, trusted);
    }
}
