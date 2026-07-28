// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ModeLib} from "@erc7579/lib/ModeLib.sol";
import {ExecutionLib} from "@erc7579/lib/ExecutionLib.sol";

import {DelegationManager} from "delegation-framework/src/DelegationManager.sol";
import {EncoderLib} from "delegation-framework/src/libraries/EncoderLib.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/src/utils/Types.sol";

import {JipsaSettlementToken} from "../src/JipsaSettlementToken.sol";
import {OwnerBindingRegistry} from "../src/OwnerBindingRegistry.sol";

/// @notice GIWA Sepolia 실체인 데모: 자금 이전 → 바인딩 → 위임 서명 → 에이전트 리딤.
///
/// 사용:
///   forge script script/DemoRedeem.s.sol --rpc-url giwa_sepolia --broadcast
///
/// 필요 환경변수: PRIVATE_KEY(배포자), OWNER_PRIVATE_KEY(도장 보유 주인),
///                AGENT_PRIVATE_KEY(에이전트)
///
/// @dev 주인 EOA는 이미 7702 코드를 보유하고 있어야 한다. 예치 단계는 없다 —
///      주인 EOA 잔액에서 리딤이 직접 집행된다.
contract DemoRedeem is Script {
    JipsaSettlementToken constant TOKEN = JipsaSettlementToken(0x1E743C166FaeeEe5b840A471a6760535AE4076B0);
    OwnerBindingRegistry constant REGISTRY = OwnerBindingRegistry(0x6ef7F805fBCaA49cbfc11C861E2EC051549433C7);
    DelegationManager constant DELEGATION_MANAGER =
        DelegationManager(0x46C7b0aaC0Cde81744823a305FBb86D31D4F7F89);
    address constant DOJANG_ENFORCER = 0x8C9c8437C27003f3d86F438c7147668d9cC5948C;
    address constant PER_TX_ENFORCER = 0xdea5DF3357e0EEf6A841d3639d115eb57b42B642;
    address constant GATE = 0xD13aE574E53F2D14F71411383CcEeC9c16529fc3;
    address constant ALLOWED_TARGETS = 0x977156e9b7Ae812C542FDbE3eEa0b93Fe87C0371;
    address constant ALLOWED_METHODS = 0x816E3D68470E84Db37799ECA14dc9EBD86b37591;
    address constant TOTAL_BUDGET_ENFORCER = 0x4cC2931c6dB25aAaA6360b802b7987f2A39eF559;
    address constant PERIOD_ENFORCER = 0x73e8aEF3aD187524FD44B8f9b5B700689FE41071;
    address constant TIMESTAMP_ENFORCER = 0x972298257A69792B0219900D8A2C9DAeC8094cC6;

    /// @dev 가맹처 A — TESTNET FAUCET 도장 보유 (2026-07-28 확인).
    ///      verifiedRecipientOnly=true 정책에서 결제가 통과해야 하는 주소.
    address constant MERCHANT_A = 0x49af607820B112Aa35097D0eb9B8AfE2235C181F;

    uint256 constant FUND_OWNER = 10_000e6; // 주인 EOA로 옮길 tKRW
    // MVP 시나리오 데모 정책
    uint256 constant PER_TX_CAP = 50e6;
    uint256 constant TOTAL_CAP = 5_000e6; // 누적 총액
    uint256 constant DAILY_CAP = 500e6; // 기간(1일)당 상한
    uint256 constant PAY_AMOUNT = 2e6; // 에이전트가 결제할 금액 (번역 1건)
    uint256 constant VALID_DAYS = 7;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        uint256 ownerPk = vm.envUint("OWNER_PRIVATE_KEY");
        uint256 agentPk = vm.envUint("AGENT_PRIVATE_KEY");

        address owner = vm.addr(ownerPk);
        address agent = vm.addr(agentPk);
        address merchant = MERCHANT_A;

        console.log("owner   :", owner);
        console.log("agent   :", agent);
        console.log("merchant:", merchant);
        console.log("owner tKRW before :", TOKEN.balanceOf(owner));
        console.log("merchant tKRW before:", TOKEN.balanceOf(merchant));

        // 1) 주인 EOA에 tKRW 확보 (예치가 아니라 주인 지갑 자체의 잔액)
        if (TOKEN.balanceOf(owner) < FUND_OWNER) {
            vm.broadcast(deployerPk);
            // forge-lint: disable-next-line(erc20-unchecked-transfer) — 실패 시 스크립트가 revert한다
            TOKEN.transfer(owner, FUND_OWNER);
        }

        // 2) 바인딩: 주인 제안 → 에이전트 수락
        if (REGISTRY.ownerOf(agent) != owner) {
            vm.broadcast(ownerPk);
            REGISTRY.proposeBinding(agent);

            vm.broadcast(agentPk);
            REGISTRY.acceptBinding(owner);
        }

        // 3) 위임 EIP-712 서명 (오프체인 — 브로드캐스트 없음)
        Delegation memory d_ = _sign(ownerPk, owner, agent);
        console.log("delegation hash:", vm.toString(EncoderLib._getDelegationHash(d_)));

        // 4) 에이전트가 일반 tx로 리딤 (번들러 불필요)
        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = d_;

        bytes[] memory permissionContexts_ = new bytes[](1);
        permissionContexts_[0] = abi.encode(delegations_);

        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();

        bytes[] memory executionCallDatas_ = new bytes[](1);
        executionCallDatas_[0] = ExecutionLib.encodeSingle(
            address(TOKEN), 0, abi.encodeWithSelector(TOKEN.transfer.selector, merchant, PAY_AMOUNT)
        );

        vm.broadcast(agentPk);
        DELEGATION_MANAGER.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);

        console.log("--- redeem submitted ---");
        console.log("paid:", PAY_AMOUNT);
    }

    // 참고: 누적 상한이 없던 초기 데모 위임
    // 0x46282044fe5d257fb1ed53808bd84f0730ca21550e8633d709352a4b8c21e413 은
    // 2026-07-28 disableDelegation 으로 무효화 완료
    // (tx 0xe61a243915e6da3ef86a2febb49afd3b90f11654e9c77a8cff1eb79e8da7195b).
    // 재구성 함수는 정책 상수가 바뀌면 해시가 어긋나 오해를 부르므로 제거했다.

    /// @notice 건당 상한을 넘는 리딤이 실체인에서 실제로 막히는지 확인한다.
    ///         브로드캐스트하지 않고 시뮬레이션만 한다 (revert를 기대).
    ///   forge script script/DemoRedeem.s.sol --sig "overCap()" --rpc-url giwa_sepolia
    function overCap() external {
        uint256 ownerPk = vm.envUint("OWNER_PRIVATE_KEY");
        uint256 agentPk = vm.envUint("AGENT_PRIVATE_KEY");
        address owner = vm.addr(ownerPk);
        address agent = vm.addr(agentPk);

        Delegation memory d_ = _sign(ownerPk, owner, agent);

        Delegation[] memory delegations_ = new Delegation[](1);
        delegations_[0] = d_;
        bytes[] memory permissionContexts_ = new bytes[](1);
        permissionContexts_[0] = abi.encode(delegations_);
        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory executionCallDatas_ = new bytes[](1);
        executionCallDatas_[0] = ExecutionLib.encodeSingle(
            address(TOKEN),
            0,
            abi.encodeWithSelector(TOKEN.transfer.selector, vm.addr(ownerPk), PER_TX_CAP + 1)
        );

        vm.prank(agent);
        DELEGATION_MANAGER.redeemDelegations(permissionContexts_, modes_, executionCallDatas_);
        console.log("!!! OVER-CAP REDEEM SUCCEEDED - enforcer is NOT working");
    }

    function _sign(uint256 ownerPk, address owner, address agent)
        internal
        view
        returns (Delegation memory d_)
    {
        // ⚠️ 건당 상한만으로는 누적 손실이 제한되지 않는다. JipsaPerTxCapEnforcer는
        //    실행 1건당 금액만 보므로, 상한 이하 리딤을 반복하면 잔액 전체가 빠진다.
        //    누적 상한(ERC20TransferAmount)·기간 상한(ERC20PeriodTransfer)·
        //    만료(Timestamp)를 반드시 함께 넣어야 피해 상한이 성립한다.
        // 순서 확정: 타겟 → 메서드 → 만료 → 건당 → 총예산 → 기간 → Dojang
        // 건당 상한을 금액 검사 앞에 두어야 과다 청구가 PerTxCapExceeded로 걸린다.
        // 근거·회귀 테스트: test/erc7710/DemoScenario.t.sol
        Caveat[] memory c_ = new Caveat[](7);
        c_[0] = Caveat({
            enforcer: ALLOWED_TARGETS,
            terms: abi.encodePacked(address(TOKEN)),
            args: hex""
        });
        c_[1] = Caveat({
            enforcer: ALLOWED_METHODS,
            terms: abi.encodePacked(TOKEN.transfer.selector),
            args: hex""
        });
        c_[2] = Caveat({
            enforcer: TIMESTAMP_ENFORCER,
            // uint128로의 축소는 안전하다 (unix 초는 2^128을 넘지 않는다)
            // forge-lint: disable-next-line(unsafe-typecast)
            terms: abi.encodePacked(uint128(0), uint128(block.timestamp + VALID_DAYS * 1 days)),
            args: hex""
        });
        c_[3] = Caveat({
            enforcer: PER_TX_ENFORCER,
            terms: abi.encodePacked(address(TOKEN), PER_TX_CAP),
            args: hex""
        });
        c_[4] = Caveat({
            enforcer: TOTAL_BUDGET_ENFORCER,
            terms: abi.encodePacked(address(TOKEN), TOTAL_CAP),
            args: hex""
        });
        c_[5] = Caveat({
            enforcer: PERIOD_ENFORCER,
            terms: abi.encodePacked(address(TOKEN), DAILY_CAP, uint256(1 days), block.timestamp),
            args: hex""
        });
        c_[6] = Caveat({
            enforcer: DOJANG_ENFORCER,
            terms: abi.encode(GATE, address(REGISTRY), address(TOKEN), true),
            args: hex""
        });

        d_ = Delegation({
            delegate: agent,
            delegator: owner,
            authority: DELEGATION_MANAGER.ROOT_AUTHORITY(),
            caveats: c_,
            salt: 2,
            signature: hex""
        });

        bytes32 typedDataHash_ = MessageHashUtils.toTypedDataHash(
            DELEGATION_MANAGER.getDomainHash(), EncoderLib._getDelegationHash(d_)
        );
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(ownerPk, typedDataHash_);
        d_.signature = abi.encodePacked(r_, s_, v_);
    }
}
