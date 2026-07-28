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
│   └── MockVerifiedGate.sol      # 데모/테스트용 mock (플랜 B)
├── OwnerBindingRegistry.sol      # 에이전트 지갑 ↔ 검증된 주인 바인딩
└── PolicyAccount.sol             # 지출 정책이 강제되는 에이전트 컨트랙트 지갑
script/
└── Deploy.s.sol
test/
├── PolicyAccount.t.sol           # MockVerifiedGate 기반 단위 테스트
└── DojangVerifiedGate.fork.t.sol # GIWA Sepolia 포크 테스트
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

## 시작하기

```bash
git submodule update --init --recursive   # lib/forge-std
forge build
forge test -vvv

# DojangScroll 실제 조회를 검증하는 포크 테스트 포함
forge test --fork-url https://sepolia-rpc.giwa.io

# 배포 (환경변수: PRIVATE_KEY)
forge script script/Deploy.s.sol --rpc-url https://sepolia-rpc.giwa.io --broadcast

# verify (익스플로러 Blockscout 계열)
forge verify-contract <ADDRESS> src/PolicyAccount.sol:PolicyAccount \
  --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api
```

## ⚠️ 배포 전 확인 사항 (TODO)

1. **Verified Address 발급**: TESTNET FAUCET attester로 본인 지갑에 발급 가능한지 확인 (buidl@giwa.io 문의 중). 불가 시 `MockVerifiedGate` 사용하고 문서에 명시.
2. **verify 명령의 verifier-url**: 익스플로러 API 경로 실제 확인 필요.
