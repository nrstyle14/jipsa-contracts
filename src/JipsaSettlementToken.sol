// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title JipsaSettlementToken (tKRW)
/// @notice JIPSA 데모용 정산 토큰.
///
/// @dev ⚠️ 무담보 테스트 정산 토큰이다. 스테이블코인이 아니며 데모 전용이다.
///      원화 담보도, 상환 청구권도, 감사도 없다. 가치를 보장하지 않는다.
///      실서비스에서는 규제 적합 스테이블코인으로 교체한다.
///      EIP-2612(permit) · 6 decimals 등 실물 스테이블코인이 통상 제공하는
///      인터페이스를 맞춰 두어, 교체 시 PolicyAccount 변경 없이 주소만 바꾸면 되도록 했다.
contract JipsaSettlementToken is ERC20, ERC20Permit, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice faucet 1회 지급량 (1,000 tKRW)
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    /// @notice 주소당 faucet 쿨다운
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice 주소별 마지막 faucet 호출 시각 (0이면 미사용)
    mapping(address => uint256) public lastFaucetAt;

    event Faucet(address indexed to, uint256 amount);

    /// @param availableAt 다음 faucet 호출이 가능해지는 시각
    error FaucetCooldown(uint256 availableAt);

    constructor()
        ERC20("JIPSA Test Settlement KRW", "tKRW")
        ERC20Permit("JIPSA Test Settlement KRW")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /// @notice 원화 최소단위 감각에 맞춰 6 decimals를 쓴다 (실물 스테이블코인 관행과 동일).
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice 데모 편의용 셀프 민팅. 주소당 24시간에 한 번.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        // 24시간 쿨다운은 초 단위 시각 조작에 영향받지 않는다 (데모 편의 기능).
        // forge-lint: disable-next-line(block-timestamp)
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @dev ERC20 + ERC20Pausable 다중 상속 해소 (OZ v5는 _update 훅 하나로 통합).
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
