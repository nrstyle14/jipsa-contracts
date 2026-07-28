import { isHex, type Address, type Hex } from "viem";

/**
 * 환경변수 읽기 도우미.
 *
 * ⚠️ **개인키는 절대 로그·에러 메시지에 담지 않는다.** 값이 잘못됐을 때도
 *    형식만 알려주고 값은 노출하지 않는다.
 */
export function requirePrivateKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `${name} 가 설정되지 않았습니다. 저장소 루트 .env 에 넣으세요 (.env 는 gitignore 처리됨).\n` +
        `  실행 전: set -a; source .env; set +a`,
    );
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  // 값은 출력하지 않는다 — 길이·형식만 검사한다
  if (!isHex(key) || key.length !== 66) {
    throw new Error(`${name} 형식이 올바르지 않습니다 (0x + 64 hex 문자여야 함).`);
  }
  return key;
}

export function optionalAddress(name: string): Address | undefined {
  const v = process.env[name];
  return v ? (v as Address) : undefined;
}

export function optionalString(name: string): string | undefined {
  return process.env[name] || undefined;
}
