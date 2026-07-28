# @jipsa/delegation

대시보드(`apps/dashboard`)와 에이전트(`apps/agent`)가 공유하는 ERC-7710 위임 조립 패키지.

## 왜 이 패키지가 필요한가

caveat `terms` 인코딩은 enforcer마다 다르고(packed vs abi.encode, 길이 고정),
EIP-712 서명 대상에서는 `signature`·`args`가 제외되며, 위임 해시는 EIP-712
typed-data 해시가 아니라 구조체 해시다. 이걸 대시보드와 에이전트가 각자
구현하면 반드시 어긋난다. 여기 한 곳에서만 만든다.

## 상수의 출처

EIP-712 도메인·`ROOT_AUTHORITY`·ModeCode·타입해시는 전부
`lib/delegation-framework` v1.3.0 소스에서 읽었고, 각 상수에 파일·줄 번호를
주석으로 남겼다. **추측한 값은 없다.**

## 인코딩 검증 방식

`test/encoding.test.ts`의 기대값은 스냅샷이 아니라 **Solidity에서 뽑은 값**이다.

```bash
forge script script/PrintCaveats.s.sol   # 기대값 재생성
pnpm test
```

TS와 Solidity 인코딩이 어긋나면 테스트가 깨진다. 실제로 이 방식으로
`getDelegationHash`의 버그(caveat 해시 배열을 `abi.encode`로 이어 붙인 것 —
원본은 `abi.encodePacked`)를 잡았다.

`test/roundtrip.test.ts`는 GIWA Sepolia를 포크한 anvil에 대고 서명 → 리딤
왕복을 검증한다. anvil이나 주인 키가 없으면 자동 skip한다.

```bash
anvil --fork-url https://sepolia-rpc-flashblocks.giwa.io --port 8545
set -a; source ../../.env; set +a
pnpm test
```

## 주의

- **caveat 순서를 바꾸지 말 것.** 차단 사유가 순서에 의존한다 (`buildCaveats` 주석 참조).
- **누적 상한을 빼지 말 것.** 건당 상한만으로는 반복 리딤을 막지 못한다.
- **`startDate`는 체인 시각을 쓸 것.** 로컬 벽시계가 앞서면 기간 enforcer가
  `transfer-not-started`로 첫 리딤을 막는다. `startDateFromChain(client)` 사용 권장.
- **batch 모드로 보내지 말 것.** 우리 caveat은 Timestamp를 빼면 전부 single 전용이다.
