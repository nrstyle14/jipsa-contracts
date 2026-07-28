import type { Address, Hex } from "viem";

/**
 * GIWA Sepolia 네트워크 정보.
 * 출처: README.md "GIWA 세폴리아 네트워크 정보"
 */
export const CHAIN_ID = 91342 as const;
export const RPC_URL = "https://sepolia-rpc.giwa.io" as const;
/**
 * Flashblocks 엔드포인트.
 *
 * preconfirmation 조회용이자, **일반 RPC가 rate limit(HTTP 429)에 걸릴 때의 대체 경로**다.
 * Dojang 검증이 EAS 스토리지를 많이 읽어 공개 RPC에서 429가 잘 발생한다
 * (2026-07-28 실측: 일반 RPC 브로드캐스트 실패 → 이 엔드포인트로 즉시 성공).
 */
export const FLASHBLOCKS_RPC_URL = "https://sepolia-rpc-flashblocks.giwa.io" as const;
export const EXPLORER_URL = "https://sepolia-explorer.giwa.io" as const;

/**
 * GIWA Sepolia 실배포 주소 (2026-07-28 배포·verify 완료).
 * 출처: README.md "배포 주소 (GIWA Sepolia)"
 */
export const ADDR = {
  /** tKRW — 무담보 테스트 정산 토큰, 6 decimals */
  tKRW: "0x1E743C166FaeeEe5b840A471a6760535AE4076B0",
  /** Dojang 도장 검증 게이트 (DojangScroll을 조회) */
  dojangGate: "0xD13aE574E53F2D14F71411383CcEeC9c16529fc3",
  /** 에이전트 ↔ 검증된 주인 바인딩 레지스트리 */
  bindingRegistry: "0x6ef7F805fBCaA49cbfc11C861E2EC051549433C7",
  /** ERC-7710 위임 매니저 (프레임워크 v1.3.0 원본) */
  delegationManager: "0x46C7b0aaC0Cde81744823a305FBb86D31D4F7F89",
  /** 주인 EOA에 7702로 심는 구현체 */
  delegator7702Impl: "0x50bC6Ac159bd85838Af8A42Fd482B8f633FeA38D",

  // ---- enforcer: JIPSA 고유 ----
  /** 수신처 도장 · 바인딩 일치 · 주인 도장 */
  dojangEnforcer: "0x8C9c8437C27003f3d86F438c7147668d9cC5948C",
  /** 실행 1건당 상한 (누적 상한과 반드시 함께 쓸 것) */
  perTxCapEnforcer: "0xdea5DF3357e0EEf6A841d3639d115eb57b42B642",

  // ---- enforcer: 스톡 (프레임워크 v1.3.0) ----
  allowedTargetsEnforcer: "0x977156e9b7Ae812C542FDbE3eEa0b93Fe87C0371",
  allowedMethodsEnforcer: "0x816E3D68470E84Db37799ECA14dc9EBD86b37591",
  /** 누적 총예산 */
  erc20TransferAmountEnforcer: "0x4cC2931c6dB25aAaA6360b802b7987f2A39eF559",
  /** 기간(일간) 한도 */
  periodTransferEnforcer: "0x73e8aEF3aD187524FD44B8f9b5B700689FE41071",
  /** 만료 */
  timestampEnforcer: "0x972298257A69792B0219900D8A2C9DAeC8094cC6",

  // ---- Dojang 인프라 (GIWA 제공) ----
  dojangScroll: "0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9",
} as const satisfies Record<string, Address>;

/**
 * Dojang attesterId — **발급 기관 식별자이며 attester의 지갑 주소가 아니다.**
 * `DojangScroll.isVerified(address, bytes32)`의 두 번째 인자.
 */
export const ATTESTER_ID = {
  testnetFaucet: "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678",
  upbitKorea: "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034",
} as const satisfies Record<string, Hex>;

/**
 * 데모 참가자 (2026-07-28 온체인 확인).
 */
export const DEMO = {
  /** 주인 EOA — 7702 코드 보유 + TESTNET FAUCET 도장 보유 */
  owner: "0x7d558dEAf66985aE1358D96152EF1b7A28857a6C",
  /** 에이전트 EOA — 레지스트리 바인딩 완료 (isAccountableAgent=true) */
  agent: "0xA8aa05641CE239F5Ceb3dFbd8EF5955D97CEBFdA",
  /** 가맹처 A — TESTNET FAUCET 도장 보유 (verifiedRecipientOnly=true에서 결제 가능) */
  merchantA: "0x49af607820B112Aa35097D0eb9B8AfE2235C181F",
} as const satisfies Record<string, Address>;

/** tKRW 소수점 자리수 */
export const TKRW_DECIMALS = 6 as const;

/** tKRW 최소단위 변환 — `tkrw(5000)` = 5,000 tKRW */
export function tkrw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** TKRW_DECIMALS));
}
