// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";

contract JipsaSettlementTokenTest is Test {
    JipsaSettlementToken token;

    address user = makeAddr("user");
    address stranger = makeAddr("stranger");

    function setUp() public {
        token = new JipsaSettlementToken();
    }

    function test_Metadata() public view {
        assertEq(token.name(), "JIPSA Test Settlement KRW");
        assertEq(token.symbol(), "tKRW");
        assertEq(token.decimals(), 6);
    }

    function test_DeployerHasRoles() public view {
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(token.hasRole(token.MINTER_ROLE(), address(this)));
        assertTrue(token.hasRole(token.PAUSER_ROLE(), address(this)));
    }

    function test_RevertWhen_NonMinterMints() public {
        // 역할 값을 미리 읽어둔다 — expectRevert 인자 안에서 호출하면 그 외부 호출이
        // vm.prank을 소비해 정작 mint는 테스트 컨트랙트 권한으로 실행된다.
        bytes32 minterRole = token.MINTER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, minterRole
            )
        );
        token.mint(stranger, 1e6);
    }

    // ---------- faucet ----------

    function test_FaucetMintsFixedAmount() public {
        vm.prank(user);
        token.faucet();
        assertEq(token.balanceOf(user), token.FAUCET_AMOUNT());
        assertEq(token.balanceOf(user), 1_000e6);
    }

    /// @notice 연속 호출은 쿨다운에 막히고, 24시간 뒤에는 다시 가능하다.
    function test_RevertWhen_FaucetCalledWithinCooldown() public {
        vm.prank(user);
        token.faucet();
        uint256 availableAt = block.timestamp + token.FAUCET_COOLDOWN();

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(JipsaSettlementToken.FaucetCooldown.selector, availableAt)
        );
        token.faucet();

        vm.warp(availableAt);
        vm.prank(user);
        token.faucet();
        assertEq(token.balanceOf(user), 2 * token.FAUCET_AMOUNT());
    }

    function test_FaucetCooldownIsPerAddress() public {
        vm.prank(user);
        token.faucet();

        // 다른 주소는 영향받지 않는다
        vm.prank(stranger);
        token.faucet();
        assertEq(token.balanceOf(stranger), token.FAUCET_AMOUNT());
    }

    // ---------- pause ----------

    function test_PauseBlocksTransfers() public {
        token.mint(user, 10e6);
        token.pause();

        vm.prank(user);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        // forge-lint: disable-next-line(erc20-unchecked-transfer) — revert를 기대하는 호출
        token.transfer(stranger, 1e6);

        token.unpause();
        vm.prank(user);
        assertTrue(token.transfer(stranger, 1e6));
        assertEq(token.balanceOf(stranger), 1e6);
    }

    function test_RevertWhen_NonPauserPauses() public {
        bytes32 pauserRole = token.PAUSER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, pauserRole
            )
        );
        token.pause();
    }

    // ---------- EIP-2612 ----------

    /// @dev 실물 스테이블코인 교체 호환을 위해 permit 인터페이스가 살아 있는지 확인
    function test_PermitSetsAllowance() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitSigner");
        token.mint(signer, 10e6);

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256(
                            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                        ),
                        signer,
                        stranger,
                        5e6,
                        token.nonces(signer),
                        block.timestamp + 1 hours
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        token.permit(signer, stranger, 5e6, block.timestamp + 1 hours, v, r, s);
        assertEq(token.allowance(signer, stranger), 5e6);
    }
}
