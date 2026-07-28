import type { Address } from "viem";

/**
 * up.id 역조회 — 수신처를 사람이 읽는 검증된 ID로 표기 (설계서 §5.3 "가능하면").
 *
 * ⚠️ **미구현.** up.id 레지스트리의 컨트랙트 주소·조회 함수를 확인하지 못했다.
 *    추측으로 주소나 시그니처를 넣으면 조용히 잘못된 이름을 표시하게 되므로
 *    (지시서 컷라인: 상수 추측 금지) 해석기를 인터페이스로만 두고 항상
 *    undefined를 반환한다. 호출부는 축약 주소로 폴백한다.
 *
 *    붙일 때: GIWA 문서에서 up.id 레지스트리 주소와 `reverse(address)` 계열
 *    함수를 확인한 뒤 여기만 채우면 화면 코드는 건드릴 필요가 없다.
 */
export function useUpId(_address: Address | undefined): string | undefined {
  return undefined;
}
