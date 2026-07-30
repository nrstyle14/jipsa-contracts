# JIPSA Contracts

검증된 주인(Dojang Verified Address)에게 온체인 바인딩된 AI 에이전트 지갑·지출 정책 인프라.

## 구조

```
src/
├── interfaces/
│   ├── IDojangScroll.sol         # DojangScroll 조회 인터페이스 (isVerified)
│   └── IVerifiedGate.sol         # 신원 검증 게이트 추상화
├── gates/
│   ├── DojangVerifiedGate.sol    # Dojang Verified Address 기반 검증 (실전용)
│   └── MockVerifiedGate.sol      # 테스트 전용 mock (배포 스크립트에서는 사용 안 함)
├── enforcers/
│   ├── DojangCaveatEnforcer.sol  # ERC-7710 — 책임 귀속 강제 (JIPSA 고유)
│   └── JipsaPerTxCapEnforcer.sol # ERC-7710 — 건당 상한
├── JipsaSettlementToken.sol      # tKRW — 데모용 정산 토큰 (스테이블코인 아님)
├── OwnerBindingRegistry.sol      # 에이전트 지갑 ↔ 검증된 주인 바인딩
└── PolicyAccount.sol             # 지출 정책이 강제되는 에이전트 컨트랙트 지갑 (플랜 B)
script/
├── Deploy.s.sol                  # 플랜 B 스택
├── DeployErc7710.s.sol           # ERC-7710 스택 (프레임워크 + enforcer)
├── DemoRedeem.s.sol              # 실체인 데모 (자금→바인딩→서명→리딤)
└── PrintCaveats.s.sol            # caveat terms 기준값 출력 (TS 인코딩 교차검증용)
test/
├── JipsaSettlementToken.t.sol    # 토큰 (역할, faucet 쿨다운, pause, permit)
├── OwnerBindingRegistry.t.sol    # 바인딩 (프런트러닝 차단, 제안 취소)
├── PolicyAccount.t.sol           # 지출 정책 단위 테스트
├── ForkTestBase.sol              # 포크 공통 상수 + 블록 하한 가드 (MIN_FORK_BLOCK)
├── DojangVerifiedGate.fork.t.sol # 실제 DojangScroll 조회 검증
├── PolicyAccount.fork.t.sol      # 실제 도장으로 바인딩→지출 통합 검증
└── erc7710/
    ├── DelegationRedeem.t.sol    # 7702 리딤 사이클 (서명·철회·Dojang)
    ├── FullCaveatSet.t.sol       # caveat 7종 조합 + 위반 5종
    ├── CumulativeDrain.t.sol     # 건당 상한만으로는 잔액이 빠진다 (회귀 고정)
    ├── DemoScenario.t.sol        # 차단 사유가 caveat 순서에 의존 (회귀 고정)
    ├── DojangEnforcer.fork.t.sol # enforcer × 실제 DojangScroll
    └── LiveCycle.fork.t.sol      # 실배포 주소 + 실도장 주인 축약 사이클
```

컨트랙트 밖은 pnpm 워크스페이스다. 대시보드·에이전트는 공유 패키지 하나만 본다.

```
packages/delegation/src/          # 공유: 주소·ABI·caveat 인코딩·EIP-712·revert 디코딩
apps/dashboard/src/               # 관제 웹앱 (Vite + React + wagmi/viem + Tailwind)
├── viewer.tsx                    #   조회 주소 결정 — 읽기 전용 열람(?viewAs=) 지원
├── hooks/useLiveFeed.ts          #   실시간 피드 (Flashblocks pending → 확정 승격)
├── hooks/useDaemon.ts            #   에이전트 데몬 제어 (status · inject · pay-now)
└── components/                   #   등록 마법사 · 공격 주입 · 긴급 철회 · 설명 팝업
apps/agent/                       # 에이전트 (Node + tsx)
├── src/daemon.ts                 #   상주 데몬 — 주기 결제 + 로컬 제어 API
├── src/agent.ts                  #   시나리오 모드 (normal · attack · revoked)
└── scripts/                      #   grant · pay · trigger-block · verify · e2e
```

## GIWA 세폴리아 네트워크 정보

| 항목 | 값 |
|---|---|
| Chain ID | 91342 |
| RPC | https://sepolia-rpc.giwa.io |
| Flashblocks RPC | https://sepolia-rpc-flashblocks.giwa.io |
| Explorer | https://sepolia-explorer.giwa.io |
| Faucet | https://docs.giwa.io/get-started/faucets |

## Dojang 컨트랙트 주소 (GIWA Sepolia)

`DojangVerifiedGate`가 직접 호출하는 컨트랙트는 DojangScroll 하나뿐이다.
EAS·AttestationIndexer·스키마 UID 조회는 모두 DojangScroll 내부에서 처리된다.

| 이름 | 주소 |
|---|---|
| DojangScroll | `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9` |

`isVerified(address subject, bytes32 attesterId)`에 넘기는 attesterId
(발급 기관 식별자이며, attester의 지갑 주소가 아니다):

| 발급 기관 | attesterId |
|---|---|
| TESTNET FAUCET | `0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678` |
| UPBIT KOREA | `0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034` |

출처: https://docs.giwa.io/giwa-ecosystem/dojang/contracts

## 배포 주소 (GIWA Sepolia)

전부 Blockscout에서 verify 완료. 아래 12건 배포 gas 합계 **10,841,972**
(`DeployErc7710` 브로드캐스트 전체는 초기 발행 `mint` 1건이 더해져 10,915,043).

> **verify 기준 커밋**: 익스플로러에 등록된 소스는 `a14a988` 시점의 `src/`다.
> 이후 `b693e90`에서 `JipsaPerTxCapEnforcer.sol`에 "단독 사용 금지" 경고 **주석만**
> 추가했다. 로직 변경은 0줄이며, 배포된 바이트코드를 현재 소스와 비교해
> immutable 슬롯(생성자 인자)과 메타데이터 해시를 제외한 **실행 코드가 동일함을
> 확인했다**. 주석이 메타데이터 해시를 바꾸므로 같은 주소에 재verify는 불가능하다 —
> 저장소 HEAD와 익스플로러 소스를 나란히 비교하면 이 주석 블록만 차이가 난다.
> 재배포는 하지 않았다 (주소가 바뀌고 로직은 동일하므로).

| 컨트랙트 | 주소 |
|---|---|
| JipsaSettlementToken (tKRW) | `0x1E743C166FaeeEe5b840A471a6760535AE4076B0` |
| DojangVerifiedGate | `0xD13aE574E53F2D14F71411383CcEeC9c16529fc3` |
| OwnerBindingRegistry | `0x6ef7F805fBCaA49cbfc11C861E2EC051549433C7` |
| DelegationManager | `0x46C7b0aaC0Cde81744823a305FBb86D31D4F7F89` |
| EIP7702StatelessDeleGator | `0x50bC6Ac159bd85838Af8A42Fd482B8f633FeA38D` |
| AllowedTargetsEnforcer | `0x977156e9b7Ae812C542FDbE3eEa0b93Fe87C0371` |
| AllowedMethodsEnforcer | `0x816E3D68470E84Db37799ECA14dc9EBD86b37591` |
| ERC20TransferAmountEnforcer | `0x4cC2931c6dB25aAaA6360b802b7987f2A39eF559` |
| ERC20PeriodTransferEnforcer | `0x73e8aEF3aD187524FD44B8f9b5B700689FE41071` |
| TimestampEnforcer | `0x972298257A69792B0219900D8A2C9DAeC8094cC6` |
| **DojangCaveatEnforcer** | `0x8C9c8437C27003f3d86F438c7147668d9cC5948C` |
| **JipsaPerTxCapEnforcer** | `0xdea5DF3357e0EEf6A841d3639d115eb57b42B642` |

## 정산 토큰 — tKRW

결제 수단은 배포 시 고정되는 단일 ERC-20 `JipsaSettlementToken`(tKRW, 6 decimals) 하나다.

> ⚠️ **무담보 테스트 정산 토큰이며 스테이블코인이 아니다.** 원화 담보도, 상환 청구권도,
> 감사도 없고 가치를 보장하지 않는다. 데모 전용이다.

다만 EIP-2612(`permit`), 6 decimals 등 **실물 스테이블코인이 통상 제공하는 인터페이스에
맞춰 두었다.** 메인넷에서는 규제 적합 스테이블코인으로 교체하며, `PolicyAccount`는
`IERC20`만 알고 있으므로 배포 시 토큰 주소만 바꾸면 된다.

### 데모 물량은 어디서 오나

두 경로가 있다.

1. **배포 시 초기 발행** — 두 배포 스크립트 모두 토큰을 새로 만들면서 배포자에게
   `DEMO_MINT_AMOUNT = 100_000e6`(10만 tKRW)을 한 번 민팅한다. 데모에서 주인 EOA·
   가맹처에 tKRW를 넣을 때 쓰는 물량이 이것이다. 배포자는 `MINTER_ROLE`을 갖고 있어
   모자라면 더 발행할 수 있다. 단 `DeployErc7710`에 `TOKEN_ADDRESS`를 넘겨 기존
   토큰을 재사용하면 이 민팅을 건너뛴다 — 이미 배포된 tKRW로 다시 돌릴 때가 그렇다.
2. **`faucet()`** — 호출자에게 1,000 tKRW를 민팅한다 (주소당 24시간 쿨다운).
   자기 주소에만 넣을 수 있어 남에게 배분하는 용도로는 못 쓴다.

배포자 `0xA53826D1959A254F10c2F96f8e7A0F1D8E520A26`의 잔액이 곧 데모 예비 물량이다.

### 자금 투입 (플랜 B `PolicyAccount` 한정)

주인이 tKRW를 `PolicyAccount` 주소로 **직접 transfer** 한다. 받는 함수가 없고 지급은
자기 잔액에서 `safeTransfer` 로 나가므로, 컨트랙트 주소에 잔액이 있어야 한다.

**approve 플로우는 일부러 두지 않았다** — approve 가 열려 있으면 에이전트가 다단계
호출로 한도 밖 손실을 만들 수 있어 "피해가 한도 안에 갇힌다"는 보장이 깨진다
(임의 call 을 제거한 것과 같은 이유. 아래 "한계" 참조).

실제 데모 경로인 7702 모델에는 **이 단계가 없다.** 예치가 없고 주인 EOA 잔액에서
바로 나가므로 자금을 옮겨 둘 곳이 아예 없다 (아래 "격리 모델의 차이" 참조).

## 시작하기

```bash
cp .env.example .env                     # 필요한 키·기본값이 주석으로 들어 있다

# lib/forge-std · lib/openzeppelin-contracts · lib/delegation-framework(v1.3.0)
# delegation-framework 가 없으면 forge build 부터 실패한다 — 계정·매니저를 여기서 가져온다
git submodule update --init --recursive
forge build
forge test -vvv                          # 55개 통과 · 9개는 포크 전용이라 skip (총 64개)

# DojangScroll 실제 조회를 검증하는 포크 테스트까지 포함 — 64개 전부 통과해야 한다.
# RPC와 고정 블록은 foundry.toml 의 [profile.fork] 에 박혀 있다 (명령에 숫자를 쓰지 않는다).
# 블록을 고정하면 Foundry가 포크 상태를 캐시해 재실행이 빨라지고 rate limit 을 피한다.
# ⚠️ 새 블록으로 처음 돌리면 캐시가 비어 요청이 몰려 rate limit 에 걸릴 수 있다.
#    한 번 실패하면 잠시 뒤 다시 돌린다 — 두 번째부터는 캐시가 받쳐준다.
FOUNDRY_PROFILE=fork forge test

# 개별 verify가 필요한 경우 (예: 데모 중 생성한 PolicyAccount)
forge verify-contract <ADDRESS> src/PolicyAccount.sol:PolicyAccount \
  --chain-id 91342 \
  --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api/ \
  --constructor-args $(cast abi-encode \
    'c(address,address,address,address,address,(uint256,uint256,uint256,uint64,bool))' \
    <OWNER> <AGENT> <REGISTRY> <GATE> <TOKEN> '(100000000000,1000000000,10000000000,<VALID_UNTIL>,false)')
```

**배포는 대개 할 필요가 없다** — 위 "배포 주소" 표의 스택이 이미 살아 있다. 새로 올려야
하면 아래 [ERC-7710 위임 스택 → 배포](#배포)로 간다.
가스가 없으면 https://docs.giwa.io/get-started/faucets 에서 받는다.

## ERC-7710 위임 스택

MetaMask delegation-framework **감사 태그 v1.3.0**을 그대로 배포하고, JIPSA는
책임 귀속을 강제하는 caveat enforcer 2종만 공급한다. 커스텀 계정 코드는 0줄이다.

| 컨트랙트 | 출처 |
|---|---|
| `DelegationManager`, `EIP7702StatelessDeleGator` | 프레임워크 원본 (v1.3.0) |
| `AllowedTargets`, `AllowedMethods`, `ERC20TransferAmount`, `ERC20PeriodTransfer`, `Timestamp` | 스톡 enforcer |
| `DojangCaveatEnforcer` | **JIPSA** — 수신처 도장 · 바인딩 일치 · 주인 도장 |
| `JipsaPerTxCapEnforcer` | **JIPSA** — 건당 상한 (스톡에 없음) |

스톡 enforcer는 "얼마나"를 제한하고, `DojangCaveatEnforcer`는 "누가 책임지는가"를 강제한다.

> **caveat 순서 (확정)**: ① AllowedTargets ② AllowedMethods ③ Timestamp
> ④ **JipsaPerTxCap** ⑤ ERC20TransferAmount ⑥ ERC20PeriodTransfer ⑦ Dojang.
> caveat은 배열 순서대로 실행되므로 **차단 사유가 순서에 의존한다** — 건당 상한을
> 금액 검사 앞에 두어야 과다 청구가 `PerTxCapExceeded`로 걸린다. Dojang은 외부
> 컨트랙트 조회라 맨 뒤. 회귀 테스트: `test/erc7710/DemoScenario.t.sol`

> **batch 전용 enforcer는 넣지 말 것**: 우리 caveat은 `Timestamp`만 빼고 전부
> `onlySingleCallTypeMode`라, `ExactExecutionBatchEnforcer` 같은 batch 전용을
> 한 위임에 섞으면 어떤 모드로도 리딤할 수 없다. 배치 실행 자체는 `DeleGatorCore`가
> 이미 지원하므로 코드 추가가 필요 없고, 배치로 가면 Dojang·누적/기간 상한을 포기해야
> 한다. approve+후속 호출이 필요해지면 위임을 두 장으로 분리한다.

> ⚠️ **caveat 구성 필수 조건**: `JipsaPerTxCapEnforcer`는 실행 1건당 금액만 보는
> 무상태 enforcer다. 위임은 `disableDelegation` 전까지 무제한 재사용 가능하고 리딤
> 횟수 제한도 없으므로, **건당 상한만 넣으면 상한 이하 리딤을 반복해 잔액 전체가 빠진다**
> (배치 리딤이면 한 트랜잭션으로도 가능). 7702 모델은 예치가 없어 주인 EOA 잔액 전체가
> 위임 표면이므로 이는 치명적이다. **누적 상한 `ERC20TransferAmountEnforcer`를 항상
> 함께 넣어야 하며**, 기간 상한과 만료도 권장한다.
> 회귀 테스트: `test/erc7710/CumulativeDrain.t.sol`

### 배포

```bash
# ⚠️ script/Deploy.s.sol 이 아니다 — 그건 플랜 B(PolicyAccount) 스택이며 데모에 쓰지 않는다.
# PRIVATE_KEY는 .env에 두면 foundry가 자동으로 읽는다 (.env는 gitignore 처리됨).
# --verify를 붙이면 생성자 인자를 broadcast 기록에서 가져와 자동 처리한다.
# 익스플로러는 Blockscout v11.1.3이며 API 키가 필요 없다.
forge script script/DeployErc7710.s.sol \
  --rpc-url giwa_sepolia \
  --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://sepolia-explorer.giwa.io/api/
```

12건 합계 **10,841,972 gas** (내역은 위 "배포 주소" 절). 플랜 B 스택만 따로 올릴 일이
있으면 `script/Deploy.s.sol` 이고 tKRW·Gate·Registry 세 개뿐이라 **2,487,474** 다
(1,404,602 · 498,799 · 584,073).

이미 배포된 것을 재사용하려면 `TOKEN_ADDRESS` / `GATE_ADDRESS` / `REGISTRY_ADDRESS`를 넘긴다.
EntryPoint는 v0.7(`0x0000000071727De22E5E9d8BAf0edAc6f37da032`)을 쓴다 —
프레임워크 v1.3.0이 account-abstraction v0.7.0을 전제하며, GIWA Sepolia에 배포되어 있다.

### 전제: 도장 보유 데모 주인 EOA

7702 모델의 주인은 **전용 데모 EOA**를 쓴다. 개인 KYC 주소를 delegator로 쓰면 그 주소의
전 잔액이 위임 표면이 되고, type-4 셋업 때문에 결국 그 키를 CLI에 넣어야 한다.

1. 새 EOA 생성 (`cast wallet new ~/.foundry/keystores demoOwner` 또는 `cast wallet new`)
2. 플레이그라운드에서 **TESTNET FAUCET** attester로 그 주소에 Verified Address 발급
3. 확인 — `true`가 나와야 한다

```bash
cast call 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9 "isVerified(address,bytes32)(bool)" <데모주인주소> 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678 --rpc-url https://sepolia-rpc.giwa.io
```

이 도장이 있어야 `OwnerBindingRegistry.proposeBinding`과 `DojangCaveatEnforcer`의
주인 검사를 통과한다. 도장 발급 전에는 포크 테스트도 정상 리딤까지 갈 수 없다.

### 주인 EOA에 EIP-7702 코드 심기 (1회)

```bash
cast send <주인EOA> --auth <EIP7702StatelessDeleGator주소> --private-key $OWNER_PRIVATE_KEY --rpc-url https://sepolia-rpc.giwa.io
```

확인 — `0xef0100` + 구현체 주소가 나와야 한다.

```bash
cast code <주인EOA> --rpc-url https://sepolia-rpc.giwa.io
```

> **주의 1**: `forge script`에서 `vm.signAndAttachDelegation`으로는 되지 않는다. forge 1.7.1
> 기준 브로드캐스트 시 type-4 트랜잭션이 만들어지지 않으며, 스크립트가
> "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL"을 출력해도 코드가 심기지 않는다.
> 로컬 anvil(상태 반영 지연이 없는 환경)에서 같은 노드로 비교해 확인했다.

> **주의 2**: `cast send` 직후 바로 `cast code`를 읽으면 아직 `0x`로 보일 수 있다.
> 공개 RPC의 상태 반영 지연이며 실패가 아니다. EIP-7702는 유효하지 않은
> authorization을 revert 없이 건너뛰므로 `status 1`만으로는 성공을 판정할 수 없다 —
> **한 블록 정도 뒤에 `cast code`로 다시 확인할 것.**

> **지갑 제약**: dapp 이 type-4 authorization 서명을 요청하는 **표준 지갑 API 가 없다** —
> MetaMask 한정이 아니라 어느 지갑으로도 브라우저에서 할 수 없다 (viem 도 인젝티드 계정에
> 대해 이 서명을 거부한다). `personal_sign` 으로 우회할 수도 없다: authorization 은 접두사
> 없는 원시 서명이어야 하는데 그 메서드는 `\x19Ethereum Signed Message:` 를 붙인다.
> 그래서 이 단계만 주인 데모 키로 CLI 에서 처리한다. 코드가 심어진 뒤의 주인 동작
> (위임 EIP-712 서명, `disableDelegation`, 일반 tx)은 **지갑으로 수행한다 — 단 위임 서명은
> Rabby 가 필요하다** (아래 "주인 지갑" 참조).

### 실체인 데모 실행

```bash
forge script script/DemoRedeem.s.sol --rpc-url giwa_sepolia --broadcast
```

자금 이전 → 바인딩(제안·수락) → 위임 EIP-712 서명(오프체인) → 에이전트 리딤을
한 번에 수행한다. `PRIVATE_KEY`(배포자)·`OWNER_PRIVATE_KEY`(도장 보유 주인)·
`AGENT_PRIVATE_KEY`(에이전트)가 필요하다.

건당 상한이 실제로 막히는지는 브로드캐스트 없이 확인할 수 있다 —
`PerTxCapExceeded`로 revert해야 정상이다.

```bash
forge script script/DemoRedeem.s.sol --sig "overCap()" --rpc-url giwa_sepolia
```

GIWA Sepolia 실행 결과 :

| 단계 | gas | 결과 |
|---|---|---|
| `transfer` (주인 EOA 자금) | 53,804 | 성공 |
| `proposeBinding` | 130,056 | 성공 |
| `acceptBinding` | 195,047 | 성공 |
| `redeemDelegations` | 217,075 | 성공 — 주인 EOA에서 250 tKRW 직접 지급 |
| 상한 초과 리딤 | — | `PerTxCapExceeded`로 차단 |

### 주인 지갑 — Rabby 를 쓴다

주인이 하는 동작 중 **위임 EIP-712 서명만 지갑이 갈린다** .

| 주인이 하는 동작 | MetaMask | Rabby |
|---|---|---|
| 위임 EIP-712 서명 | **정책 차단** | **동작 확인** |
| `disableDelegation` · faucet 전송 | 가능 | 가능 |
| EIP-7702 셋업 (type-4) | 불가 | 불가 (표준 지갑 API 부재 — 공통) |
| GIWA 네트워크 추가 | 가능 | 대시보드 버튼으로 자동 추가 |

MetaMask 는 도메인 `DelegationManager` + `primaryType: Delegation` 조합을 알아보고
`External signature requests cannot sign delegations for internal accounts` (-32603) 로
거부한다. 자사 스마트 계정의 ERC-7715 `wallet_grantPermissions` 로만 이 흐름을 연다.

위임 서명은 지출 권한을 넘기는 행위이고, 일반 서명 팝업으로
아무 dapp 이나 받으면 위험하다. JIPSA 가 지적하는 문제와 같은 문제의식이며, 우리는 그
권한을 컨트랙트 레벨 정책으로 묶어 해결한다. 그래서 **대시보드는 MetaMask 를 연결
목록에서 제외**한다 (`window.ethereum` 폴백까지 함께 막는다).

지갑 없이 볼 수도 있다 — `?viewAs=<주소>` 로 열면 에이전트·게이지·실시간 피드를
읽기 전용으로 열람하고 쓰기 버튼은 전부 잠긴다.

### 대시보드·에이전트 실행

```bash
# 루트 .env 는 "시작하기"에서 이미 복사했다. 대시보드는 템플릿이 따로다 —
# Vite 는 envDir 기본값이 apps/dashboard 라서 루트 .env 를 읽지 않는다.
cp apps/dashboard/.env.example apps/dashboard/.env.local   # 전부 선택값이라 생략 가능
pnpm install
pnpm -r typecheck
pnpm -F @jipsa/delegation test   # 26개 통과 · 5개는 RPC 필요라 skip (총 31개)

# 터미널 1 — 관제 대시보드 (http://localhost:5173)
pnpm -F @jipsa/dashboard dev

# 터미널 2 — 에이전트 데몬 (주기 결제 + 대시보드 제어 API :8787)
set -a; source .env; set +a
pnpm -F @jipsa/agent daemon                      # 기본 30초 주기 · 건당 2 tKRW
pnpm -F @jipsa/agent daemon -- --interval 120000  # 촬영 중 한도를 아끼려면
```

위임 발급은 대시보드 마법사(Rabby 서명) 또는 CLI 로 한다. 발급된
`delegation.json` 을 `apps/agent/` 에 두면 데몬이 다음 주기에 자동으로 집는다.

```bash
pnpm -F @jipsa/agent grant          # 주인 키로 발급 (OWNER_PRIVATE_KEY)
pnpm -F @jipsa/agent verify         # 리딤 가능한지 시뮬레이션으로 검증
pnpm -F @jipsa/agent pay -- --count 3 --interval 2000
pnpm -F @jipsa/agent agent -- --scenario attack   # 인젝션 → 이중 차단
pnpm -F @jipsa/agent agent -- --enable            # 철회한 위임 되살리기
pnpm -F @jipsa/agent agent -- --mode claude       # 작업당 지급액을 LLM 이 정함
pnpm -F @jipsa/agent e2e            # 전건 통과가 촬영 가능 판정 기준 (N/N 으로 출력)
```

> ⚠️ **일간 한도는 데몬이 켜져 있으면 빠르게 소진된다.** 30초 × 2 tKRW = 시간당
> 240 tKRW 이므로 일간 500 은 약 2시간에 바닥난다. 바닥나면 데몬은 주기 결제를
> **멈추고** 사유를 남긴다(가스를 태우지 않는다). enforcer 상태는 `delegationHash` 가
> 키라서 **위임을 새로 발급하면 한도가 리셋**된다.

> ⚠️ **e2e 를 연속 실행하지 말 것.** 한 번에 온체인 호출이 40건 이상이고 Dojang 검증처럼
> 무거운 `eth_call` 이 섞여 있어, 쉬지 않고 3회 돌리면 2회차부터 `over rate limit` 으로
> 실패한다(회복 1~2분). 실행 사이에 1~2분을 두거나 전용 RPC(`RPC_URL`)를 쓴다.

#### 에이전트가 실제로 판단하게 하기 (`--mode claude`)

기본값은 스크립트 모드다 — 작업마다 지급액이 코드에 박혀 있다. `--mode claude` 를 주면
**작업당 지급액을 LLM 이 정한다** (`ANTHROPIC_API_KEY` 필요, 모델은 `CLAUDE_MODEL`,
기본 `claude-sonnet-5`).

온체인 동작은 두 모드가 같다 — enforcer 는 누가 결정했는지 모르고 금액·대상·도장만 본다.
그래서 **인젝션 시연에서 이 모드가 의미를 갖는다**: 스크립트 모드의 "공격"은 우리가 짠
분기지만, claude 모드는 `injection.txt` 를 외부 입력으로 LLM 에 먹여
(`askClaudeUnderInjection`) 실제로 판단을 흔들고, 그 결과가 컨트랙트에서 막히는 것을
보여준다. 판단은 속을 수 있어도 caveat 은 속지 않는다는 것이 요지다.

#### 데몬은 배포할 수 없다

데몬은 **에이전트 개인키를 들고** 결제 tx 를 직접 서명한다. Vercel 같은 곳에 올릴 수
없고, 배포된 대시보드에는 부를 상대가 없다 — 그래서 데몬 연동은 `localhost` 에서 열었을
때만 기본 활성이다. 대시보드만 배포하면 조회·위임 발급은 되고 에이전트 제어만 빠진다.

원격에서 붙이려면 `apps/dashboard/.env.local` 의 `VITE_DAEMON_URL` 에
**HTTPS 터널** 주소(ngrok · cloudflared)를 넣는다.
HTTPS 페이지에서 `http://` 는 혼합 콘텐츠로 막히고, 사설망 주소는 Chrome 의 Private
Network Access 프리플라이트도 통과해야 한다.

> ⚠️ **터널로 노출하면 `DAEMON_TOKEN` 을 반드시 설정할 것.** CORS 는 브라우저만 막는다 —
> `curl` 은 그냥 통과하므로 토큰이 없으면 누구나 `/inject` 를 호출해 남의 데몬에
> 인젝션을 밀어넣을 수 있다. 대시보드에는 같은 값을 `apps/dashboard/.env.local` 의
> `VITE_DAEMON_TOKEN` 으로 넣는다.

### 격리 모델의 차이 (중요)

`PolicyAccount`는 **예치한 예산**이 피해 상한이었다. 7702 모델은 예치가 없고 주인 EOA
잔액 전체가 위임 대상이 되므로, **피해 상한 = enforcer가 강제하는 캡**이다. 총예산
enforcer가 곧 금고 칸막이다. 데모는 한도를 타이트하게 설정한 전용 데모 EOA로 진행한다.

`PolicyAccount`는 플랜 B로 `main`에 유지된다.

## 한계

### 일부러 뺀 것

- **단일 토큰 전용** — 계정·위임 하나가 토큰 하나만 취급한다. 멀티토큰은 정책 한도의
  의미가 토큰별로 갈라져 통제가 흐려지므로 범위에서 제외했다.
- **`PolicyAccount`에 임의 call 없음** — `execute(address,uint256,bytes)`를 제거했다. 임의
  call이 열려 있으면 에이전트가 approve·다단계 호출로 한도 밖 손실을 만들 수 있어 "피해가
  위임 한도 안에 갇힌다"는 보장이 성립하지 않는다. 남은 저수준 call은 `revoke()`가 오입금된
  ETH를 주인에게 되돌려주는 경로 하나뿐이다. 7702 경로는 프레임워크 계정이 임의 실행을
  지원하므로 제거가 아니라 `AllowedTargets`·`AllowedMethods` caveat 으로 좁힌다 —
  tKRW 의 `transfer` 외에는 리딤이 revert 한다.
- **업그레이드 프록시 없음** — 모든 컨트랙트가 불변이다. 변경은 재배포로 처리한다.
- **EIP-3009 미구현** — 가맹처가 가스를 대납하는 `transferWithAuthorization` 흐름은
  로드맵이다.

### 아직 만들지 않은 것 (데모 범위)

- **가맹처 API 실호출 없음** — 에이전트는 작업 큐를 처리하는 척하고 결제만 실제로 한다.
- **대시보드는 위임을 한 장만 보관한다** — 에이전트를 둘 등록하면 한 번에 하나만 온전히
  보인다 (멀티 위임 관리 UI 는 범위에서 제외).
- **운영 권한이 배포자 한 주소에 모여 있다** — tKRW 의 `MINTER_ROLE`·`PAUSER_ROLE`·
  `DEFAULT_ADMIN_ROLE`, `DojangVerifiedGate.admin`, `DelegationManager.owner` 가 모두
  `0xA53826D1959A254F10c2F96f8e7A0F1D8E520A26` 다. 데모용 무담보 토큰이라 문제가 아니지만
  메인넷에서는 멀티시그·타임락으로 옮겨야 한다.
