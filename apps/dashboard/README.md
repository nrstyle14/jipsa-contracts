# @jipsa/dashboard

주인이 에이전트 지갑을 **위임 → 관제 → 철회**하는 단일 페이지 웹앱.

```bash
pnpm -F @jipsa/dashboard dev     # http://localhost:5173
pnpm -F @jipsa/dashboard build
```

설정은 전부 선택값이다. 필요하면 템플릿을 복사한다.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

> ⚠️ **저장소 루트 `.env` 로는 동작하지 않는다.** Vite 는 `envDir` 기본값이 자기
> 프로젝트 루트(`apps/dashboard`)라서 루트 `.env` 를 읽지 않는다. 루트를 읽게 만들 수도
> 있지만 그 파일에는 개인키가 있어, 이름을 `VITE_` 로 잘못 붙이는 순간 브라우저 번들에
> 실린다. 그래서 분리해 둔다.

`VITE_RPC_URL` 을 비우면 **Flashblocks 엔드포인트**를 쓴다 — Dojang 검증이 EAS 스토리지를
많이 읽어 일반 RPC 는 HTTP 429 가 잦다.

## 지갑은 Rabby 다

**MetaMask 는 연결 목록에서 제외한다.** 연결 자체는 되지만 위임 EIP-712 서명을 정책적으로
거부하기 때문이다 — 도메인 `DelegationManager` + `primaryType: Delegation` 조합을 알아보고
`External signature requests cannot sign delegations for internal accounts` (-32603) 를
낸다. 고를 수 있게 두면 반드시 그것부터 눌러 보고 위임 서명에서 막힌다.

`window.ethereum` 폴백도 함께 막는다. EIP-6963 에 MetaMask 만 있으면 그 폴백이 곧 같은
MetaMask 이므로, 목록에서만 지우면 "브라우저 지갑" 이라는 이름으로 뒷문이 열린다
(`window.ethereum.isMetaMask` 로 판별하지 않는 이유: Rabby 도 호환을 위해 그 플래그를
참으로 둬서 신뢰할 수 없다).

`WhyRabby.tsx` 팝업이 화면에서 이 이유를 설명한다.

## 개인키 입력란은 없다 (절대)

dapp 이 type-4 authorization 서명을 요청하는 **표준 지갑 API 가 없다** — MetaMask 한정이
아니라 어느 지갑으로도 브라우저에서 할 수 없다. `personal_sign` 으로 우회할 수도 없다:
authorization 은 접두사 없는 원시 서명이어야 하는데 그 메서드는 접두사를 붙인다.

그래서 7702 셋업은 **CLI 명령을 안내만** 하고(`WhyDelegationAccount.tsx` 팝업이 왜 이
단계가 필요한지, ERC-4337 로 가면 없앨 수 있다는 점까지 설명한다), 대시보드는 어떤
형태로도 개인키를 받지 않는다.

## 화면 구성

**게이트·배지** (`onboarding/`)
- 도장 배지 — `DojangVerifiedGate.isVerified`
- **7702 위임 계정 배지** — `eth_getCode` 가 `0xef0100 + 구현체주소` 와 **전체 일치**하는지
  본다. 접두사만 보면 다른 구현체를 가리키는 계정을 통과시킨다.
- `ChainGuard` — 체인이 다르면 전환을 안내한다 (GIWA 미등록 지갑에는 네트워크 추가까지)
- `ReadOnlyBanner` — `?viewAs=<주소>` 로 열면 지갑 없이 열람하고 쓰기 버튼은 전부 잠긴다

**에이전트** (`agent/`)
- 목록 `agentsOf` · 바인딩 상태 `ownerOf` / `pendingOwnerOf` / `isAccountableAgent`
- 정책 요약 + 지출 게이지 3개(건당·일간·총예산) · tKRW 잔액
- 이름 표시 — `useAgentLabels` 의 로컬 라벨이다. 표시용이며 신뢰의 근거가 아니다
  (근거는 "책임지는 사람" 카드의 온체인 바인딩)
- `useUpId` — 이더리움 **메인넷** ENS + CCIP-Read(`https://id.giwa.io/gateway/…`) 로
  up.id 이름을 해석한다. 역방향 조회 후 **정방향으로 다시 검증**해 도용을 막는다.
  데모 EOA 에는 등록된 이름이 없어 주소 축약으로 폴백된다
- `AttackPanel` — 프롬프트 인젝션을 데몬에 주입하고 차단 결과를 보여준다
- `RevokeButton` — 긴급 철회

**실시간 피드** (`feed/`)
- `useLiveFeed` — 이벤트 폴링 + Flashblocks pending 선반영 → 확정 승격.
  **실패한 리딤은 로그를 남기지 않으므로** 차단 행은 tx 를 되짚어 사유를 디코딩한다
  (`@jipsa/delegation` 의 `decodeRevertFromError()`).

**데몬 제어** (`useDaemon`)
- 상태 조회 · 인젝션 주입 · 즉시 결제. 데몬이 꺼져 있는 것은 오류가 아니라 정상 상태로
  다룬다. 데몬은 에이전트 개인키를 들고 있어 배포할 수 없으므로 `localhost` 에서 열었을
  때만 기본 활성이다.

## 위임을 왜 불러와야 하나

7702 모델에는 `PolicyAccount.policy()` 같은 온체인 정책 레코드가 없다. 정책은 주인이
서명한 위임의 caveat terms 안에만 존재한다. 그래서 화면은 서명된 위임을 받아
`decodePolicy()` 로 terms 를 되짚어 표시하고, 지출은 enforcer 상태를 `delegationHash`
키로 조회한다.

- 누적: `ERC20TransferAmountEnforcer.spentMap(delegationManager, hash)`
- 기간: `ERC20PeriodTransferEnforcer.getAvailableAmount(hash, delegationManager, terms)`
  — 리딤 0건이라 enforcer 가 초기화되지 않은 상태에서도 terms 로 시뮬레이션해주므로
  발급 직후에도 게이지가 정확하다
- 철회 여부: `DelegationManager.disabledDelegations(hash)`

위임을 얻는 경로는 두 개다. 등록 마법사로 새로 서명해 발급하거나(발급 즉시 브라우저에
보관 + `delegation.json` 다운로드), 이미 발급한 파일을 불러오거나. 파일 불러오기는
마법사가 대체한 것이 아니라 **CLI(`pnpm -F @jipsa/agent grant`)로 발급한 경우를 위한
병행 경로**다. 이 파일은 개인키가 아니라 **서명된 공개 산출물**이다.

> 대시보드는 위임을 **한 장만** 보관한다(`useStoredDelegation`, `localStorage`).
> 에이전트를 둘 등록하면 한 번에 하나만 온전히 보인다.

## 등록 마법사

3단계다.

1. `proposeBinding` 서명 — 온체인 tx
2. 에이전트 수락 안내 — CLI 명령을 복사한다. `cancelProposal` 로 취소 가능
3. 위임 EIP-712 서명 → 브라우저 보관 + `delegation.json` 다운로드

위임 발급은 **온체인 트랜잭션이 아니다.** EIP-712 서명만 받으며 예치도 없다.

`startDate` 는 `startDateFromChain()` 으로 **체인 시각**을 읽어 쓴다 — 로컬 벽시계가
앞서면 기간 enforcer 가 `transfer-not-started` 로 첫 리딤을 막는다.

에이전트 수락 명령은 `acceptBinding(address)` 로 `expectedOwner` 를 넘긴다. 제안은
누구나 덮어쓸 수 있어, 수락 직전 다른 주인으로 바뀌는 프런트러닝을 막는 설계다.

## 긴급 철회에 자금 회수 단계가 없다

`DelegationManager.disableDelegation` 을 직접 호출한다. tKRW 는 처음부터 주인 EOA 의
잔액이고 끊는 것은 권한뿐이므로 회수할 대상이 없다. 이것이 `PolicyAccount`(플랜 B)와
갈리는 지점이다 — 그쪽은 예치한 예산이 피해 상한이었다.

철회 후 리딤은 `CannotUseADisabledDelegation` 으로 막힌다. enforcer 상태는
`delegationHash` 가 키라서 **위임을 새로 발급하면 한도가 리셋**된다.
