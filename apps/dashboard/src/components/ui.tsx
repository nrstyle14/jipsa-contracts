import type { ReactNode } from "react";
import { TKRW_DECIMALS } from "@jipsa/delegation";

/** tKRW 최소단위 → 사람이 읽는 문자열 */
export function fmtTkrw(v: bigint | undefined, opts?: { unit?: boolean }): string {
  if (v === undefined) return "—";
  const base = 10n ** BigInt(TKRW_DECIMALS);
  const whole = v / base;
  const frac = v % base;
  const s =
    frac === 0n
      ? whole.toLocaleString("ko-KR")
      : `${whole.toLocaleString("ko-KR")}.${frac.toString().padStart(TKRW_DECIMALS, "0").replace(/0+$/, "")}`;
  return opts?.unit === false ? s : `${s} tKRW`;
}

export function shortAddr(a: string | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-card border border-line bg-surface p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Chip({
  tone = "muted",
  children,
}: {
  tone?: "ok" | "red" | "blue" | "muted";
  children: ReactNode;
}) {
  const tones = {
    ok: "bg-[#1E3A2A] text-[#7FD39B] border-ok/40",
    red: "bg-redSoft text-[#E8A6A1] border-red/40",
    blue: "bg-surface2 text-[#9FC0DA] border-blue/40",
    muted: "bg-surface2 text-muted border-line",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "ghost",
  children,
  ...rest
}: { variant?: "primary" | "ghost" | "red" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = {
    primary: "bg-blue text-bg hover:brightness-110",
    ghost: "border border-line bg-surface2 text-text hover:border-blue",
    red: "bg-red text-white hover:brightness-110",
  } as const;
  return (
    <button
      {...rest}
      className={`rounded-btn px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${v[variant]} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** 게이지 — 사용률을 색으로도 알린다 (80% 넘으면 적색) */
export function Gauge({
  label,
  used,
  cap,
}: {
  label: string;
  used: bigint | undefined;
  cap: bigint | undefined;
}) {
  const pct =
    used === undefined || cap === undefined || cap === 0n
      ? undefined
      : Number((used * 1000n) / cap) / 10;
  const clamped = pct === undefined ? 0 : Math.min(100, Math.max(0, pct));
  const hot = (pct ?? 0) >= 80;

  return (
    <div className="mb-3.5 num">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <b className={hot ? "text-red" : "text-text"}>
          {pct === undefined ? "—" : `${pct.toFixed(1)}%`}
          <span className="ml-2 font-normal text-muted">
            {fmtTkrw(used, { unit: false })} / {fmtTkrw(cap)}
          </span>
        </b>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2">
        <div
          className={`h-full rounded-full transition-all ${hot ? "bg-red" : "bg-blue"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
