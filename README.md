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
├── JipsaSettlementToken.sol      # tKRW — 데모용 정산 토큰 (스테이블코인 아님)
├── OwnerBindingRegistry.sol      # 에이전트 지갑 ↔ 검증된 주인 바인딩
└── PolicyAccount.sol             # 지출 정책이 강제되는 에이전트 컨트랙트 지갑
script/
└── Deploy.s.sol
test/
├── JipsaSettlementToken.t.sol    # 토큰 (역할, faucet 쿨다운, pause, permit)
├── OwnerBindingRegistry.t.sol    # 바인딩 (프런트러닝 차단, 제안 취소)
├── PolicyAccount.t.sol           # 지출 정책 단위 테스트
├── ForkTestBase.sol              # 포크 테스트 공통 상수·가드
├── DojangVerifiedGate.fork.t.sol # 실제 DojangScroll 조회 검증
└── PolicyAccount.fork.t.sol      # 실제 도장으로 바인딩→지출 통합 검증
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

배포 후 채운다.

| 컨트랙트 | 주소 |
|---|---|
| JipsaSettlementToken (tKRW) | _(미배포)_ |
| DojangVerifiedGate | _(미배포)_ |
| OwnerBindingRegistry | _(미배포)_ |

## 정산 토큰 — tKRW

결제 수단은 배포 시 고정되는 단일 ERC-20 `JipsaSettlementToken`(tKRW, 6 decimals) 하나다.

> ⚠️ **무담보 테스트 정산 토큰이며 스테이블코인이 아니다.** 원화 담보도, 상환 청구권도,
> 감사도 없고 가치를 보장하지 않는다. 데모 전용이다.

다만 EIP-2612(`permit`), 6 decimals 등 **실물 스테이블코인이 통상 제공하는 인터페이스에
맞춰 두었다.** 메인넷에서는 규제 적합 스테이블코인으로 교체하며, `PolicyAccount`는
`IERC20`만 알고 있으므로 배포 시 토큰 주소만 바꾸면 된다.

데모 편의를 위해 `faucet()`이 호출자에게 1,000 tKRW를 민팅한다 (주소당 24시간 쿨다운).

### 자금 투입

주인이 tKRW를 `PolicyAccount` 주소로 **직접 transfer** 한다. approve 플로우는 없다.

## 한계 (현재 설계에서 의도적으로 제외한 것)

- **임의 call 없음**: 기존 `execute(address,uint256,bytes)`를 제거했다. 임의 call이 열려
  있으면 에이전트가 approve·다단계 호출로 한도 밖 손실을 만들 수 있어 "피해가 위임 한도
  안에 갇힌다"는 보장이 성립하지 않는다. 남아 있는 저수준 call은 `revoke()`가 오입금된
  ETH를 주인에게 되돌려주는 경로 하나뿐이다.
- **단일 토큰 전용**: 계정당 토큰 하나만 취급한다. 멀티토큰은 정책 한도의 의미가
  토큰별로 갈라져 통제가 흐려지므로 범위에서 제외했다.
- **EIP-3009는 로드맵**: 가맹처가 가스를 대납하는 `transferWithAuthorization` 흐름은
  아직 넣지 않았다.
- **업그레이드 프록시 없음**: 모든 컨트랙트가 불변이다. 변경은 재배포로 처리한다.

## 시작하기

```bash
git submodule update --init --recursive   # lib/forge-std, lib/openzeppelin-contracts
forge build
forge test -vvv

# DojangScroll 실제 조회를 검증하는 포크 테스트 포함
# 블록을 고정하면 Foundry가 포크 상태를 캐시한다 — 재실행이 빨라지고
# 공개 RPC의 rate limit(HTTP 429)에 걸리지 않는다. 고정 없이 반복 실행하면 429로 실패할 수 있다.
forge test --fork-url https://sepolia-rpc.giwa.io --fork-block-number 31869189

# 배포 + verify (한 번에)
# PRIVATE_KEY는 .env에 두면 foundry가 자동으로 읽는다 (.env는 gitignore 처리됨).
# --verify를 붙이면 생성자 인자를 broadcast 기록에서 가져와 자동 처리한다.
# 익스플로러는 Blockscout v11.1.3이며 API 키가 필요 없다.
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia-rpc.giwa.io \
  --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://sepolia-explorer.giwa.io/api/

# 개별 verify가 필요한 경우 (예: 데모 중 생성한 PolicyAccount)
forge verify-contract <ADDRESS> src/PolicyAccount.sol:PolicyAccount \
  --chain-id 91342 \
  --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api/ \
  --constructor-args $(cast abi-encode \
    'c(address,address,address,address,address,(uint256,uint256,uint256,uint64,bool))' \
    <OWNER> <AGENT> <REGISTRY> <GATE> <TOKEN> '(100000000000,1000000000,10000000000,<VALID_UNTIL>,false)')
```

배포 비용은 세 컨트랙트 합쳐 약 3,331,845 gas (≈ 0.0000034 ETH)다.
가스가 없으면 https://docs.giwa.io/get-started/faucets 에서 받는다.

## ⚠️ 배포 전 확인 사항 (TODO)

1. **배포 주소 표 채우기**: 배포 후 위 표를 실제 주소로 갱신.
