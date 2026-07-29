import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { usePublicClient } from "wagmi";
import { ADDR, decodeRevertFromError } from "@jipsa/delegation";
import { FLASHBLOCKS_RPC_URL, giwaSepolia } from "../config/chain.js";

export type FeedStatus = "pending" | "confirmed" | "blocked";

export interface FeedRow {
  hash: Hex;
  status: FeedStatus;
  to?: Address;
  /** tKRW 최소단위 */
  amount?: bigint;
  /** 차단 사유 (커스텀 에러 이름 또는 require 문자열) */
  reason?: string;
  /** 사람이 읽는 사유 */
  label?: string;
  seenAt: number;
}

const MAX_ROWS = 50;
/**
 * 시작 시 역스캔할 블록 수.
 *
 * ⚠️ **실패한 리딤은 로그를 남기지 않는다** — `RedeemedDelegation`도 `Transfer`도 없다.
 *    따라서 pending 창에서 놓친 차단 tx는 이벤트로 복구할 수 없고, 블록의 트랜잭션
 *    목록을 직접 훑어야 한다. 블록당 1회 호출이라 무한정 늘릴 수 없으므로
 *    최근 구간만 본다 (GIWA는 ~1초 블록이라 40블록 ≈ 40초).
 *    이 덕분에 데모 중 새로고침해도 직전 차단 행이 남는다.
 */
const BACKFILL_BLOCKS = 40n;

/**
 * Flashblocks pending 폴링 간격 — 설계서 값 500ms.
 *
 * 실측: 하나의 tx가 `pending` 블록에 머무는 시간은 **약 600ms**다 (200ms 간격 폴링에서
 * 연속 3회만 히트, 2026-07-29 GIWA Sepolia). 600 > 500 이므로 500ms면 창을 놓치지 않는다.
 *
 * ⚠️ 마진을 더 주려고 300ms까지 좁혔다가 되돌렸다. `eth_getBlockByNumber("pending", true)`는
 *    블록의 전체 tx 객체(보통 16~21건)를 돌려주는 무거운 호출이고, GIWA 공개 RPC는 이런
 *    호출을 몰아치면 `over rate limit`으로 거절한다 (에이전트 스크립트에서 실측).
 *    한 번 걸리면 회복에 시간이 걸려 데모 도중에는 치명적이다 — 더 좁히지 말 것.
 *
 * ⚠️ 브라우저는 백그라운드 탭의 타이머를 ~1초로 클램프한다 — 데모 중에는 탭을 포그라운드에
 *    두어야 Pending 행이 보인다 (확정·차단 행은 영향 없다).
 */
const PENDING_POLL_MS = 500;

/** tKRW Transfer — 금액·수신처의 유일한 출처 (RedeemedDelegation은 금액을 담지 않는다) */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * 실시간 지출 피드 (설계서 §7).
 *
 * 해시를 얻는 경로가 셋이고, 상태 확정은 한 곳(resolver)에서 처리한다.
 *  1. **Pending** — Flashblocks `eth_getBlockByNumber("pending", true)` 폴링 (500ms)
 *  2. **확정 로그** — 일반 RPC에서 tKRW `Transfer(from = owner)` 폴링 (1s)
 *  3. **시작 역스캔** — 최근 블록의 tx 목록에서 `to == DelegationManager` 수집
 *
 * resolver는 아직 `pending`인 행의 영수증을 보고
 *  - `success` → 확정 (영수증 로그에서 금액·수신처 추출)
 *  - `reverted` → 차단 (`eth_call` 재실행으로 사유 디코딩)
 */
export function useLiveFeed(owner: Address | undefined, enabled = true) {
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<FeedRow[]>([]);
  /** 영수증까지 확인이 끝난 해시 — 중복 조회 방지 */
  const settled = useRef(new Set<string>());

  const flashClient = useMemo(
    () => createPublicClient({ chain: giwaSepolia, transport: http(FLASHBLOCKS_RPC_URL) }),
    [],
  );

  const upsert = useCallback((row: FeedRow) => {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.hash === row.hash);
      if (i === -1) {
        return [row, ...prev].sort((a, b) => b.seenAt - a.seenAt).slice(0, MAX_ROWS);
      }
      const cur = prev[i]!;
      // 확정·차단은 pending을 덮어쓴다. 되돌리지는 않는다.
      if (cur.status !== "pending" && row.status === "pending") return prev;
      const merged = { ...cur, ...row, seenAt: cur.seenAt };
      // 500ms pending 폴링이 같은 행을 계속 upsert한다 — 값이 같으면 리렌더를 막는다
      if (
        merged.status === cur.status &&
        merged.to === cur.to &&
        merged.amount === cur.amount &&
        merged.reason === cur.reason
      ) {
        return prev;
      }
      const next = [...prev];
      next[i] = merged;
      return next;
    });
  }, []);

  // ---- 1) Pending: Flashblocks preconfirmation (500ms) ----
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      try {
        const block = await flashClient.getBlock({
          blockTag: "pending",
          includeTransactions: true,
        });
        for (const tx of block.transactions) {
          if (typeof tx === "string") continue;
          if (tx.to?.toLowerCase() !== ADDR.delegationManager.toLowerCase()) continue;
          upsert({ hash: tx.hash, status: "pending", seenAt: Date.now() });
        }
      } catch {
        // 폴링 실패는 조용히 재시도한다 (설계서 §7 데모 안정성)
      }
    };
    void tick();
    const id = setInterval(() => {
      if (!stop) void tick();
    }, PENDING_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, flashClient, upsert]);

  // ---- 2) 확정 로그: tKRW Transfer (1s) ----
  useEffect(() => {
    if (!enabled || !owner || !publicClient) return;
    let stop = false;
    let from: bigint | undefined;

    const tick = async () => {
      try {
        const latest = await publicClient.getBlockNumber();
        from ??= latest > BACKFILL_BLOCKS ? latest - BACKFILL_BLOCKS : 0n;
        if (from > latest) return;
        const logs = await publicClient.getLogs({
          address: ADDR.tKRW,
          event: TRANSFER_EVENT,
          args: { from: owner },
          fromBlock: from,
          toBlock: latest,
        });
        for (const log of logs) {
          settled.current.add(log.transactionHash);
          upsert({
            hash: log.transactionHash,
            status: "confirmed",
            to: log.args.to,
            amount: log.args.value,
            seenAt: Date.now(),
          });
        }
        from = latest + 1n;
      } catch {
        /* 조용히 재시도 */
      }
    };
    void tick();
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 1_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, owner, publicClient, upsert]);

  // ---- 3) 시작 역스캔: 최근 블록의 DelegationManager tx ----
  useEffect(() => {
    if (!enabled || !publicClient) return;
    let stop = false;
    void (async () => {
      try {
        const latest = await publicClient.getBlockNumber();
        const start = latest > BACKFILL_BLOCKS ? latest - BACKFILL_BLOCKS : 0n;
        for (let n = latest; n >= start && !stop; n--) {
          const block = await publicClient.getBlock({
            blockNumber: n,
            includeTransactions: true,
          });
          for (const tx of block.transactions) {
            if (typeof tx === "string") continue;
            if (tx.to?.toLowerCase() !== ADDR.delegationManager.toLowerCase()) continue;
            // 상태는 resolver가 채운다. 시각은 블록 시각을 쓴다.
            upsert({
              hash: tx.hash,
              status: "pending",
              seenAt: Number(block.timestamp) * 1000,
            });
          }
        }
      } catch {
        /* 역스캔 실패는 치명적이지 않다 — pending 폴링이 계속 돈다 */
      }
    })();
    return () => {
      stop = true;
    };
  }, [enabled, publicClient, upsert]);

  // ---- resolver: pending 행의 영수증을 보고 확정/차단으로 확정한다 ----
  //
  // `rows`에 의존하지 않고 자체 인터벌로 돈다. 의존하면 pending 블록을 벗어난 뒤
  // (= 더 이상 rows가 갱신되지 않는 시점) 영수증 조회가 한 번 실패한 행이 영구히
  // pending에 갇힌다.
  const rowsRef = useRef<FeedRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    if (!enabled || !publicClient) return;
    let stop = false;

    const tick = async () => {
      const targets = rowsRef.current.filter(
        (r) => r.status === "pending" && !settled.current.has(r.hash),
      );
      for (const row of targets) {
        if (stop) return;
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: row.hash });
          settled.current.add(row.hash);

          if (receipt.status === "success") {
            const transfer = findTransfer(receipt.logs);
            upsert({
              hash: row.hash,
              status: "confirmed",
              to: transfer?.to,
              amount: transfer?.value,
              seenAt: row.seenAt,
            });
            continue;
          }

          const decoded = await revertReasonOf(publicClient, row.hash, receipt.blockNumber);
          upsert({
            hash: row.hash,
            status: "blocked",
            reason: decoded?.reason,
            label: decoded?.label,
            seenAt: row.seenAt,
          });
        } catch {
          // 아직 마이닝되지 않았다 — settled에 넣지 않고 다음 라운드에 다시 본다
        }
      }
    };

    void tick();
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 1_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, publicClient, upsert]);

  return rows;
}

/** 영수증 로그에서 tKRW Transfer를 찾아 금액·수신처를 얻는다 */
function findTransfer(logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[]) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== ADDR.tKRW.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      return { to: decoded.args.to as Address, value: decoded.args.value as bigint };
    } catch {
      /* 다른 이벤트 */
    }
  }
  return undefined;
}

/**
 * 실패한 tx를 **직전 블록 상태에서** `eth_call`로 재실행해 revert 사유를 얻는다.
 *
 * @dev 영수증에는 사유가 없다. 확정된 블록 번호로 호출하면 이미 상태가 바뀌어
 *      다른 사유가 나올 수 있으므로 `blockNumber - 1`을 쓴다.
 *      GIWA 공개 RPC는 `eth_call` 실패 시 revert 데이터를 정상 반환한다 (실측).
 */
async function revertReasonOf(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: Hex,
  blockNumber: bigint,
) {
  const tx = await client.getTransaction({ hash });
  try {
    await client.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: blockNumber - 1n,
    });
    return undefined; // 재실행이 통과하면 사유를 특정할 수 없다
  } catch (e) {
    return decodeRevertFromError(e);
  }
}
