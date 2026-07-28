/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** RPC 덮어쓰기 — 미설정 시 Flashblocks 엔드포인트를 쓴다 */
  readonly VITE_RPC_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
