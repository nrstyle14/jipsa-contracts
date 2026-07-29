import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useLiveFeed, type FeedRow } from "../../hooks/useLiveFeed.js";
import { useUpId } from "../../hooks/useUpId.js";
import { Card, Chip, fmtTkrw, shortAddr } from "../ui.js";
import { explorerTx } from "../../config/chain.js";

export function LiveFeed({ owner }: { owner: Address | undefined }) {
  const rows = useLiveFeed(owner);
  const blocked = rows.find((r) => r.status === "blocked");

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">실시간 지출 피드</h3>
        <span className="text-[11px] text-muted">확정 1s · Pending 300ms (Flashblocks)</span>
      </div>

      <BlockedToast row={blocked} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          아직 활동이 없습니다. 에이전트가 결제하면 Pending으로 즉시 나타납니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] text-muted">
                <th className="pb-2 font-normal">시간</th>
                <th className="pb-2 font-normal">Tx</th>
                <th className="pb-2 font-normal">수신처</th>
                <th className="pb-2 font-normal">금액</th>
                <th className="pb-2 font-normal">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.hash} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Row({ row }: { row: FeedRow }) {
  const upId = useUpId(row.to);
  const blocked = row.status === "blocked";

  return (
    <tr
      className={`animate-slidein border-t border-line align-middle ${
        blocked ? "bg-redSoft/60" : ""
      }`}
    >
      <td className="py-2 text-[11px] text-muted">
        {new Date(row.seenAt).toLocaleTimeString("ko-KR")}
      </td>
      <td className="py-2">
        <a
          className="text-[11px] text-blue hover:underline"
          href={explorerTx(row.hash)}
          target="_blank"
          rel="noreferrer"
        >
          {row.hash.slice(0, 10)}…
        </a>
      </td>
      <td className="py-2 text-[11px]">
        {row.to ? (upId ?? shortAddr(row.to)) : <span className="text-muted">—</span>}
      </td>
      <td className="py-2">{row.amount === undefined ? "—" : fmtTkrw(row.amount)}</td>
      <td className="py-2">
        {row.status === "pending" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-blue bg-surface2 px-2.5 py-1 text-[10.5px] font-bold text-[#9FC0DA]">
            <span className="inline-block h-2 w-2 animate-spin rounded-full border border-blue border-t-transparent" />
            Pending
          </span>
        )}
        {row.status === "confirmed" && <Chip tone="ok">✓ 확정</Chip>}
        {blocked && <Chip tone="red">차단 · {row.label ?? row.reason ?? "사유 미확인"}</Chip>}
      </td>
    </tr>
  );
}

/** 차단 행이 새로 등장하면 상단에 적색 토스트를 노출 */
function BlockedToast({ row }: { row: FeedRow | undefined }) {
  const [visible, setVisible] = useState(false);
  const lastHash = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!row || row.hash === lastHash.current) return;
    lastHash.current = row.hash;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 5_000);
    return () => clearTimeout(id);
  }, [row]);

  if (!visible || !row) return null;
  return (
    <div className="mb-3 rounded-btn border border-red/50 bg-redSoft px-3 py-2 text-sm text-[#E8A6A1]">
      정책 위반 시도가 차단되었습니다 — <b>{row.label ?? row.reason}</b>
      {row.reason && row.label !== row.reason && (
        <span className="ml-2 text-[11px] opacity-70">({row.reason})</span>
      )}
    </div>
  );
}
