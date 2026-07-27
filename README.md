# JIPSA Contracts

검증된 주인(Dojang Verified Address)에게 온체인 바인딩된 AI 에이전트 지갑·지출 정책 인프라.

## 구조

```
src/
├── interfaces/
│   ├── IEAS.sol                  # EAS 최소 인터페이스 (attestation 조회)
│   ├── IAttestationIndexer.sol   # Dojang AttestationIndexer 인터페이스 (⚠️ ABI 검증 필요)
│   └── IVerifiedGate.sol         # 신원 검증 게이트 추상화
├── gates/
│   ├── DojangVerifiedGate.sol    # Dojang Verified Address 기반 검증 (실전용)
│   └── MockVerifiedGate.sol      # 데모/테스트용 mock (플랜 B)
├── OwnerBindingRegistry.sol      # 에이전트 지갑 ↔ 검증된 주인 바인딩
└── PolicyAccount.sol             # 지출 정책이 강제되는 에이전트 컨트랙트 지갑
script/
└── Deploy.s.sol
test/
└── PolicyAccount.t.sol
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

| 이름 | 주소 |
|---|---|
| EAS | `0x4200000000000000000000000000000000000021` |
| AttestationIndexer | `0x9C9Bf29880448aB39795a11b669e22A0f1d790ec` |
| DojangScroll | `0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9` |
| Verified Address Schema UID | `0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08` |
| Attester: UPBIT KOREA | `0x4097bF3Cb731AEB3E501b910B33B2aF9Fa68E388` |
| Attester: TESTNET FAUCET | `0x63CCe2b569A7bC35895ee24306c1512fefc06121` |

출처: https://docs.giwa.io/giwa-ecosystem/dojang/contracts

## 시작하기

```bash
forge init --no-git . --force   # 기존 파일 유지 시 생략
forge install foundry-rs/forge-std
forge build
forge test -vvv

# 배포 (환경변수: PRIVATE_KEY)
forge script script/Deploy.s.sol --rpc-url https://sepolia-rpc.giwa.io --broadcast

# verify (익스플로러 Blockscout 계열)
forge verify-contract <ADDRESS> src/PolicyAccount.sol:PolicyAccount \
  --verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api
```

## ⚠️ 배포 전 확인 사항 (TODO)

1. **IAttestationIndexer ABI**: `getAttestationUid(recipient, schemaUid)` 시그니처는 추정치. [giwa-io/dojang](https://github.com/giwa-io/dojang) 저장소에서 실제 ABI 확인 후 교체할 것. DojangScroll에 더 간편한 조회 함수가 있으면 그쪽 사용 권장.
2. **Verified Address 발급**: TESTNET FAUCET attester로 본인 지갑에 발급 가능한지 확인 (buidl@giwa.io 문의 중). 불가 시 `MockVerifiedGate` 사용하고 문서에 명시.
3. **verify 명령의 verifier-url**: 익스플로러 API 경로 실제 확인 필요.
