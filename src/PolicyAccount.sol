// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVerifiedGate} from "./interfaces/IVerifiedGate.sol";
import {OwnerBindingRegistry} from "./OwnerBindingRegistry.sol";

/// @title PolicyAccount
/// @notice 지출 정책이 컨트랙트 레벨에서 강제되는 에이전트 지갑.
///         - 주인(owner)이 예산을 예치하고 정책을 위임
///         - 에이전트(agent) 키만 pay 가능, 정책 위반 시 revert
///         - 프롬프트 인젝션이 성공해도 피해는 정책 한도 안에 갇힘
///         - 주인은 즉시 회수(revoke) 가능
///
/// @dev 결제 수단은 배포 시 고정된 단일 ERC-20(tKRW) 하나뿐이다.
///      임의 call(`execute`)을 제거해 정책을 우회하는 경로를 없앴다.
///      임의 call이 열려 있으면 에이전트가 approve·다단계 호출로 한도 밖 손실을
///      만들 수 있어, "피해가 위임 한도 안에 갇힌다"는 보장이 성립하지 않는다.
contract PolicyAccount {
    using SafeERC20 for IERC20;

    struct Policy {
        uint256 totalBudget;          // 누적 지출 상한 (토큰 최소단위, 6 decimals)
        uint256 perTxCap;             // 건당 상한 (토큰 최소단위)
        uint256 dailyCap;             // 일간 상한 (토큰 최소단위)
        uint64 validUntil;            // 위임 만료 시각 (unix)
        bool verifiedRecipientOnly;   // true면 Verified Address 보유 수신처만 허용
    }

    address public immutable owner;
    address public immutable agent;
    OwnerBindingRegistry public immutable registry;
    IVerifiedGate public immutable gate;
    /// @notice 이 계정이 취급하는 유일한 정산 토큰
    IERC20 public immutable token;

    Policy public policy;
    uint256 public spentTotal;
    uint256 public spentToday;
    uint64 public dayStart;
    bool public revoked;

    event EthReceived(address indexed from, uint256 amount);
    event PolicySet(Policy policy);
    event PaymentExecuted(address indexed to, uint256 amount, uint256 spentTotal, uint256 spentToday);
    event Revoked(uint256 tokenAmount, uint256 ethAmount);
    event Withdrawn(uint256 tokenAmount, uint256 ethAmount);

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
        IERC20 token_,
        Policy memory policy_
    ) {
        owner = owner_;
        agent = agent_;
        registry = registry_;
        gate = gate_;
        token = token_;
        policy = policy_;
        dayStart = uint64(block.timestamp);
        emit PolicySet(policy_);
    }

    /// @dev 자금 투입은 주인이 tKRW를 이 주소로 직접 transfer 한다 (approve 플로우 없음).
    ///      receive는 ETH 오입금으로 자금이 묶이지 않도록 남겨둔다 — revoke에서 함께 회수된다.
    receive() external payable {
        emit EthReceived(msg.sender, msg.value);
    }

    // ---------- Owner ----------

    function setPolicy(Policy calldata p) external onlyOwner {
        policy = p;
        emit PolicySet(p);
    }

    /// @notice 위임 철회: 계정을 즉시 정지하고 토큰·ETH 잔액을 주인에게 회수한다.
    /// @dev 정지는 어떤 외부 사정으로도 막히면 안 된다. 회수를 같은 트랜잭션에 묶어
    ///      실패 시 revert하면, 토큰이 일시정지된 상황에서 `revoked = true`까지
    ///      되돌아가 주인이 에이전트를 멈추지도 못한다. 그래서 회수는 best-effort로
    ///      수행하고, 옮기지 못한 잔액은 이후 withdraw()로 회수한다.
    function revoke() external onlyOwner {
        revoked = true;
        (uint256 tokenSwept, uint256 ethSwept) = _trySweep();
        emit Revoked(tokenSwept, ethSwept);
    }

    /// @notice 잔액 회수. revoke 시점에 토큰이 일시정지되어 옮기지 못한 경우 등에 쓴다.
    ///         정지 여부와 무관하게 주인은 언제든 자금을 되찾을 수 있다.
    /// @dev revoke와 달리 전송이 실패하면 revert한다 — 주인이 실패를 알아야 하는 경로다.
    function withdraw() external onlyOwner {
        uint256 tokenBal = token.balanceOf(address(this));
        if (tokenBal > 0) {
            token.safeTransfer(owner, tokenBal);
        }

        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = owner.call{value: ethBal}("");
            if (!ok) revert CallFailed();
        }

        emit Withdrawn(tokenBal, ethBal);
    }

    /// @dev 실패해도 revert하지 않는 회수. 실제로 옮긴 금액만 돌려준다.
    function _trySweep() private returns (uint256 tokenSwept, uint256 ethSwept) {
        uint256 tokenBal = token.balanceOf(address(this));
        if (tokenBal > 0) {
            // 표준 ERC-20의 bool 반환을 전제로 한다. 실패(일시정지 등)는 삼키고
            // withdraw()로 넘긴다.
            try token.transfer(owner, tokenBal) returns (bool ok) {
                if (ok) tokenSwept = tokenBal;
            } catch {}
        }

        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool sent,) = owner.call{value: ethBal}("");
            if (sent) ethSwept = ethBal;
        }
    }

    // ---------- Agent ----------

    /// @notice 에이전트의 자율 결제 실행. 모든 정책을 통과해야 한다.
    /// @param to 수신처
    /// @param amount 지급액 (토큰 최소단위)
    function pay(address to, uint256 amount) external onlyAgent {
        if (revoked) revert AccountRevoked();
        // 위임 만료·일간 윈도우는 일 단위 정책이라 초 단위 시각 조작의 영향이 없다.
        // 즉시 정지가 필요하면 주인이 revoke()를 쓴다.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > policy.validUntil) revert DelegationExpired();
        // 실행 시점마다 "이 계정의 owner에게 귀속된 상태"를 재확인.
        // 레지스트리상 주인이 바뀌었거나 주인 KYC가 무효화되면 즉시 정지된다.
        if (registry.ownerOf(agent) != owner || !gate.isVerified(owner)) revert AgentNotBound();

        // 일간 윈도우 롤오버
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = uint64(block.timestamp - ((block.timestamp - dayStart) % 1 days));
            spentToday = 0;
        }

        if (amount > policy.perTxCap) revert PerTxCapExceeded(amount, policy.perTxCap);
        if (spentToday + amount > policy.dailyCap) revert DailyCapExceeded(spentToday + amount, policy.dailyCap);
        if (spentTotal + amount > policy.totalBudget) revert TotalBudgetExceeded(spentTotal + amount, policy.totalBudget);
        if (policy.verifiedRecipientOnly && !gate.isVerified(to)) revert RecipientNotVerified(to);

        // effects
        spentToday += amount;
        spentTotal += amount;

        // interaction
        token.safeTransfer(to, amount);

        emit PaymentExecuted(to, amount, spentTotal, spentToday);
    }

    // ---------- Views (관제 대시보드용) ----------

    /// @notice 이 계정이 보유한 정산 토큰 잔액
    function tokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @dev 주인이 setPolicy로 한도를 이미 쓴 금액보다 낮춰도 revert하지 않도록 saturating 처리.
    function remainingBudget() external view returns (uint256) {
        return spentTotal >= policy.totalBudget ? 0 : policy.totalBudget - spentTotal;
    }

    /// @dev 위와 같은 이유로 saturating 처리.
    function remainingToday() external view returns (uint256) {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= dayStart + 1 days) return policy.dailyCap;
        return spentToday >= policy.dailyCap ? 0 : policy.dailyCap - spentToday;
    }
}
