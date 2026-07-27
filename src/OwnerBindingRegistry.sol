// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifiedGate} from "./interfaces/IVerifiedGate.sol";

/// @title OwnerBindingRegistry
/// @notice AI 에이전트 지갑을 Dojang 검증된 주인(사람)에게 온체인 바인딩하는 레지스트리.
///         - 주인은 Verified Address 보유자여야 함 (gate 검증)
///         - 2단계 바인딩: 주인이 제안(propose) → 에이전트가 수락(accept)
///         - 주인은 언제든 해지(revoke) 가능
contract OwnerBindingRegistry {
    IVerifiedGate public immutable gate;

    /// @notice 에이전트 → 확정된 주인
    mapping(address => address) public ownerOf;
    /// @notice 에이전트 → 제안된 주인 (수락 대기)
    mapping(address => address) public pendingOwnerOf;
    /// @notice 주인 → 바인딩된 에이전트 목록
    mapping(address => address[]) private _agentsOf;
    /// @notice 주인, 에이전트 → _agentsOf 배열 인덱스+1 (0 = 없음)
    mapping(address => mapping(address => uint256)) private _agentIndex;

    event BindingProposed(address indexed owner, address indexed agent);
    event BindingAccepted(address indexed owner, address indexed agent);
    event BindingRevoked(address indexed owner, address indexed agent);

    error OwnerNotVerified(address owner);
    error AgentAlreadyBound(address agent);
    error NoPendingProposal(address agent);
    error NotOwnerOfAgent(address caller, address agent);
    error ZeroAddress();

    constructor(IVerifiedGate gate_) {
        gate = gate_;
    }

    /// @notice 검증된 주인이 에이전트 지갑 바인딩을 제안
    function proposeBinding(address agent) external {
        if (agent == address(0)) revert ZeroAddress();
        if (!gate.isVerified(msg.sender)) revert OwnerNotVerified(msg.sender);
        if (ownerOf[agent] != address(0)) revert AgentAlreadyBound(agent);

        pendingOwnerOf[agent] = msg.sender;
        emit BindingProposed(msg.sender, agent);
    }

    /// @notice 에이전트 지갑이 자신의 키로 바인딩을 수락 (에이전트 동의 증명)
    function acceptBinding() external {
        address owner = pendingOwnerOf[msg.sender];
        if (owner == address(0)) revert NoPendingProposal(msg.sender);
        // 수락 시점에도 주인의 검증 상태 재확인
        if (!gate.isVerified(owner)) revert OwnerNotVerified(owner);

        delete pendingOwnerOf[msg.sender];
        ownerOf[msg.sender] = owner;
        _agentsOf[owner].push(msg.sender);
        _agentIndex[owner][msg.sender] = _agentsOf[owner].length; // index+1

        emit BindingAccepted(owner, msg.sender);
    }

    /// @notice 주인이 에이전트 바인딩을 해지
    function revokeBinding(address agent) external {
        if (ownerOf[agent] != msg.sender) revert NotOwnerOfAgent(msg.sender, agent);

        delete ownerOf[agent];
        uint256 idx = _agentIndex[msg.sender][agent]; // index+1
        uint256 last = _agentsOf[msg.sender].length;
        if (idx != last) {
            address moved = _agentsOf[msg.sender][last - 1];
            _agentsOf[msg.sender][idx - 1] = moved;
            _agentIndex[msg.sender][moved] = idx;
        }
        _agentsOf[msg.sender].pop();
        delete _agentIndex[msg.sender][agent];

        emit BindingRevoked(msg.sender, agent);
    }

    // ---------- Views ----------

    function agentsOf(address owner) external view returns (address[] memory) {
        return _agentsOf[owner];
    }

    /// @notice 에이전트가 "검증된 주인에게 귀속된 상태"인지 확인.
    ///         가맹처/상대방 컨트랙트가 결제 수락 전에 호출하는 핵심 함수.
    function isAccountableAgent(address agent) external view returns (bool) {
        address owner = ownerOf[agent];
        return owner != address(0) && gate.isVerified(owner);
    }
}
