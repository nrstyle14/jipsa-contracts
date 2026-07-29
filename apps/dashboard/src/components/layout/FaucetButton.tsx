import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { ABI, ADDR } from "@jipsa/delegation";
import { Button } from "../ui.js";

/**
 * tKRW faucet — 1,000 tKRW / 24시간 (설계서 v1.1 헤더 버튼).
 * 쿨다운 중이면 남은 시간을 보여주고 비활성화한다.
 */
export function FaucetButton() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const last = useReadContract({
    address: ADDR.tKRW,
    abi: ABI.tKRW,
    functionName: "lastFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const lastAt = (last.data as bigint | undefined) ?? 0n;
  const availableAt = lastAt === 0n ? 0n : lastAt + 86_400n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const cooling = availableAt > now;
  const hoursLeft = cooling ? Number((availableAt - now) / 3600n) : 0;

  async function claim() {
    setBusy(true);
    setError(undefined);
    try {
      await writeContractAsync({
        address: ADDR.tKRW,
        abi: ABI.tKRW,
        functionName: "faucet",
      });
      await last.refetch();
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      onClick={claim}
      disabled={busy || cooling}
      title={
        error ?? (cooling ? `쿨다운 ${hoursLeft}시간 남음` : "1,000 tKRW 받기 (24시간마다)")
      }
    >
      {busy ? "요청 중…" : cooling ? `faucet · ${hoursLeft}h` : "tKRW faucet"}
    </Button>
  );
}
