/**
 * JIPSA 로고.
 *
 * 가운데 점(주인) 을 두 호(위임 신호) 가 감싸는 형태. 첨부된 마크를 벡터로 다시 그렸다 —
 * 이미지 파일 대신 인라인 SVG 인 이유는 확대에서 깨지지 않고, `currentColor` 로 테마를
 * 따라가며, 애셋 요청이 없어서다.
 *
 * 기하: 중심 (50,50) · 호 중심선 반지름 28 · 선 두께 14.5 (바깥 35.25 / 안쪽 20.75) ·
 * 가운데 점 반지름 8.5. 호는 수직에서 26° 떨어진 지점에서 끊어 위·아래가 열린다 (원본의 틈 폭에 맞춤).
 *
 * ⚠️ 캡은 `butt` 이다. `round` 로 두면 끝이 반원으로 튀어나와 위·아래 틈이 둥글고 넓어져
 *    원본과 달라진다 — 원본의 끝단은 호에 수직인 평면으로 잘려 있다.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      // 옆에 "JIPSA 관제" 텍스트가 있으므로 장식으로 둔다 — 이름을 두 번 읽히면 안 된다
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={14.5}
      strokeLinecap="butt"
    >
      {/* 왼쪽 호 — 위 끝에서 왼쪽을 지나 아래 끝으로 (화면상 반시계) */}
      <path d="M37.73 24.83 A28 28 0 0 0 37.73 75.17" />
      {/* 오른쪽 호 — 위 끝에서 오른쪽을 지나 아래 끝으로 (화면상 시계) */}
      <path d="M62.27 24.83 A28 28 0 0 1 62.27 75.17" />
      <circle cx="50" cy="50" r="8.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
