// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifiedGate} from "./interfaces/IVerifiedGate.sol";
import {OwnerBindingRegistry} from "./OwnerBindingRegistry.sol";

/// @title PolicyAccount
/// @notice 지출 정책이 컨트랙트 레벨에서 강제되는 에이전트 지갑.
///         - 주인(owner)이 예산을 예치하고 정책을 위임
///         - 에이전트(agent) 키만 execute 가능, 정책 위반 시 revert
///         - 프롬프트 인젝션이 성공해도 피해는 정책 한도 안에 갇힘
///         - 주인은 즉시 회수(revoke) 가능
contract PolicyAccount {
    struct Policy {
        uint256 totalBudget;          // 누적 지출 상한 (wei)
        uint256 perTxCap;             // 건당 상한
        uint256 dailyCap;             // 일간 상한
        uint64 validUntil;            // 위임 만료 시각 (unix)
        bool verifiedRecipientOnly;   // true면 Verified Address 보유 수신처만 허용
    }

    address public immutable owner;
    address public immutable agent;
    OwnerBindingRegistry public immutable registry;
    IVerifiedGate public immutable gate;

    Policy public policy;
    uint256 public spentTotal;
    uint256 public spentToday;
    uint64 public dayStart;
    bool public revoked;

    event Funded(address indexed from, uint256 amount);
    event PolicySet(Policy policy);
    event Executed(address indexed to, uint256 value, bytes data, uint256 spentTotal, uint256 spentToday);
    event Revoked(uint256 sweptAmount);

    error NotOwner();
    error NotAgent();
    error AccountRevoked();
    error DelegationExpired();
    error AgentNotBound();
    error PerTxCapExceeded(uint256 value, uint256 cap);
    error DailyCapExceeded(uint256 wouldBe, uint256 cap);
    error TotalBudgetExceeded(uint256 wouldBe, uint256 cap);
    error RecipientNotVerified(address to);
    error CallFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(
        address owner_,
        address agent_,
        OwnerBindingRegistry registry_,
        IVerifiedGate gate_,
        Policy memory policy_
    ) {
        owner = owner_;
        agent = agent_;
        registry = registry_;
        gate = gate_;
        policy = policy_;
        dayStart = uint64(block.timestamp);
        emit PolicySet(policy_);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ---------- Owner ----------

    function setPolicy(Policy calldata p) external onlyOwner {
        policy = p;
        emit PolicySet(p);
    }

    /// @notice 위임 철회: 계정 정지 + 잔액 전액 주인에게 회수
    function revoke() external onlyOwner {
        revoked = true;
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = owner.call{value: bal}("");
            if (!ok) revert CallFailed();
        }
        emit Revoked(bal);
    }

    // ---------- Agent ----------

    /// @notice 에이전트의 자율 결제 실행. 모든 정책을 통과해야 함.
    function execute(address to, uint256 value, bytes calldata data)
        external
        onlyAgent
        returns (bytes memory result)
    {
        if (revoked) revert AccountRevoked();
        if (block.timestamp > policy.validUntil) revert DelegationExpired();
        // 실행 시점마다 "검증된 주인에게 귀속된 상태"를 재확인 (주인 KYC 무효화 시 즉시 정지)
        if (!registry.isAccountableAgent(agent)) revert AgentNotBound();

        // 일간 윈도우 롤오버
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = uint64(block.timestamp - ((block.timestamp - dayStart) % 1 days));
            spentToday = 0;
        }

        if (value > policy.perTxCap) revert PerTxCapExceeded(value, policy.perTxCap);
        if (spentToday + value > policy.dailyCap) revert DailyCapExceeded(spentToday + value, policy.dailyCap);
        if (spentTotal + value > policy.totalBudget) revert TotalBudgetExceeded(spentTotal + value, policy.totalBudget);
        if (policy.verifiedRecipientOnly && !gate.isVerified(to)) revert RecipientNotVerified(to);

        // effects
        spentToday += value;
        spentTotal += value;

        // interaction
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed();

        emit Executed(to, value, data, spentTotal, spentToday);
        return ret;
    }

    // ---------- Views (관제 대시보드용) ----------

    function remainingBudget() external view returns (uint256) {
        return policy.totalBudget - spentTotal;
    }

    function remainingToday() external view returns (uint256) {
        if (block.timestamp >= dayStart + 1 days) return policy.dailyCap;
        return policy.dailyCap - spentToday;
    }
}
