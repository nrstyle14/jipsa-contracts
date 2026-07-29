# @jipsa/dashboard

주인이 에이전트 지갑을 **위임 → 관제 → 철회**하는 단일 페이지 웹앱.

```bash
pnpm -F @jipsa/dashboard dev     # http://localhost:5173
pnpm -F @jipsa/dashboard build
```

`VITE_RPC_URL`로 RPC를 덮어쓸 수 있다. 기본값은 **Flashblocks 엔드포인트**다 —
Dojang 검증이 EAS 스토리지를 많이 읽어 일반 RPC는 HTTP 429가 잦다.

## M1 (읽기) 범위

- 지갑 연결 (MetaMask 인젝티드만 — WalletConnect 제외)
- 도장 배지 (`DojangVerifiedGate.isVerified`)
- **7702 위임 계정 배지** — `eth_getCode`가 `0xef0100 + 구현체주소`와 전체 일치하는지
  확인한다. 접두사만 보면 다른 구현체를 가리키는 계정을 통과시킨다.
- 에이전트 목록 (`agentsOf`) · 바인딩 상태 (`ownerOf`/`pendingOwnerOf`/`isAccountableAgent`)
- 정책 요약 + 지출 게이지 3개 · tKRW 잔액

## 위임은 왜 불러와야 하나

7702 모델에는 `PolicyAccount.policy()` 같은 온체인 정책 레코드가 없다. 정책은 주인이
서명한 위임의 caveat terms 안에만 존재한다. 그래서 화면은 서명된 위임을 받아
`decodePolicy()`로 terms를 되짚어 표시하고, 지출은 enforcer 상태를 `delegationHash`
키로 조회한다.

- 누적: `ERC20TransferAmountEnforcer.spentMap(delegationManager, hash)`
- 기간: `ERC20PeriodTransferEnforcer.getAvailableAmount(hash, delegationManager, terms)`
  — 리딤 0건이라 enforcer가 초기화되지 않은 상태에서도 terms로 시뮬레이션해주므로
  발급 직후에도 게이지가 정확하다.

M1에서는 `delegation.json` 파일을 불러온다 (M2의 등록 마법사가 대체). 이 파일은
**서명된 공개 산출물**이며 개인키가 아니다.

## 개인키 입력란은 없다 (절대)

type-4 authorization 서명은 개인키 접근이 필요해 MetaMask 인젝티드로는 임의 체인에서
불가하다. 그래서 7702 셋업은 **CLI 명령을 안내만** 하고, 대시보드는 어떤 형태로도
개인키를 받지 않는다.

## M2 (쓰기) 범위

- **등록 마법사** 3단계 — ① `proposeBinding` 서명 ② 에이전트 수락 안내(CLI 명령 복사,
  `cancelProposal`로 취소 가능) ③ 위임 EIP-712 서명 → `delegation.json` 다운로드
- **tKRW faucet** — 쿨다운 중이면 남은 시간을 보여주고 비활성화
- **긴급 철회** — `DelegationManager.disableDelegation` 직접 호출.
  **자금 회수 단계가 없다** — tKRW는 처음부터 주인 EOA 잔액이고 끊는 것은 권한뿐이다.

위임 발급은 **온체인 트랜잭션이 아니다.** EIP-712 서명만 받으며 예치도 없다.
`startDate`는 체인 시각을 쓴다 — 로컬 벽시계가 앞서면 기간 enforcer가
`transfer-not-started`로 첫 리딤을 막는다.

에이전트 수락 명령은 `acceptBinding(address)`로 `expectedOwner`를 넘긴다.
제안은 누구나 덮어쓸 수 있어, 수락 직전 다른 주인으로 바뀌는 프런트러닝을 막는 설계다.

## 남은 마일스톤

- **M3 실시간**: 이벤트 폴링 + Flashblocks pending 선반영 + 차단 행/토스트
  (revert 사유 디코딩은 `@jipsa/delegation`의 `decodeRevertFromError()`가 이미 제공)
