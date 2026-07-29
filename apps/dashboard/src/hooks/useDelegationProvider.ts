import { useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { Eip712DelegationProvider } from "../components/delegation/Eip712DelegationProvider.js";

/**
 * 마법사·철회 버튼은 이 provider만 바라본다 (설계서 §10).
 * ERC-7715가 열리면 여기서 반환하는 구현만 바꾸면 된다.
 */
export function useDelegationProvider() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!publicClient || !walletClient) return undefined;
    return new Eip712DelegationProvider(publicClient, walletClient);
  }, [publicClient, walletClient]);
}
