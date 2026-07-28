import { useCallback, useEffect, useState } from "react";
import { delegationFromJson, delegationToJson, type Delegation } from "@jipsa/delegation";

const KEY = "jipsa.delegation.v1";

/**
 * 서명된 위임을 브라우저에 보관한다.
 *
 * 위임은 오프체인 산출물이므로 온체인 조회로는 정책 원본값(총예산·건당·일간·만료)을
 * 알 수 없다. 발급 시 여기 저장해두고 게이지·정책 패널이 읽는다.
 *
 * ⚠️ 여기 담기는 것은 **공개 산출물**이다 (주소·terms·서명). 개인키는 절대 담지 않는다.
 */
export function useStoredDelegation() {
  const [delegation, setDelegation] = useState<Delegation | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    try {
      setDelegation(delegationFromJson(JSON.parse(raw)));
    } catch (e) {
      // 깨진 값이 남아 화면이 계속 실패하지 않도록 지운다
      localStorage.removeItem(KEY);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const save = useCallback((d: Delegation) => {
    localStorage.setItem(KEY, JSON.stringify(delegationToJson(d)));
    setDelegation(d);
    setError(undefined);
  }, []);

  /** delegation.json 파일을 불러온다 (CLI로 발급한 위임을 화면에 붙일 때) */
  const importJson = useCallback((text: string) => {
    try {
      const d = delegationFromJson(JSON.parse(text));
      localStorage.setItem(KEY, JSON.stringify(delegationToJson(d)));
      setDelegation(d);
      setError(undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(KEY);
    setDelegation(undefined);
    setError(undefined);
  }, []);

  return { delegation, save, importJson, clear, error };
}
