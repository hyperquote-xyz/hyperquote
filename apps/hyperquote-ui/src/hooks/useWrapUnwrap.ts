"use client";

import { useState, useCallback } from "react";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { WHYPE_ADDRESS, WHYPE_ABI } from "@/lib/native-wrap";

export type WrapTxStatus = "idle" | "wrapping" | "unwrapping" | "success" | "error";

export interface WrapTxState {
  status: WrapTxStatus;
  txHash?: `0x${string}`;
  error?: string;
}

export function useWrapUnwrap() {
  const { address } = useAccount();
  const [txState, setTxState] = useState<WrapTxState>({ status: "idle" });
  const { writeContractAsync } = useWriteContract();

  // Native HYPE balance
  const {
    data: nativeBalanceData,
    refetch: refetchNative,
  } = useBalance({ address });

  // wHYPE ERC-20 balance
  const {
    data: whypeBalanceRaw,
    refetch: refetchWhype,
  } = useReadContract({
    address: WHYPE_ADDRESS,
    abi: WHYPE_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const nativeBalance = nativeBalanceData?.value ?? 0n;
  const whypeBalance = (whypeBalanceRaw as bigint) ?? 0n;

  const refetch = useCallback(async () => {
    const [native, whype] = await Promise.all([refetchNative(), refetchWhype()]);
    return {
      nativeBalance: native.data?.value ?? 0n,
      whypeBalance: (whype.data as bigint) ?? 0n,
    };
  }, [refetchNative, refetchWhype]);

  const resetTx = useCallback(() => {
    setTxState({ status: "idle" });
  }, []);

  const wrap = useCallback(
    async (amount: bigint): Promise<boolean> => {
      if (!address) return false;
      try {
        setTxState({ status: "wrapping" });

        const hash = await writeContractAsync({
          address: WHYPE_ADDRESS,
          abi: WHYPE_ABI,
          functionName: "deposit",
          value: amount,
        });

        setTxState({ status: "wrapping", txHash: hash });

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { wagmiConfig } = await import("@/lib/wagmi");

        await waitForTransactionReceipt(wagmiConfig, { hash });

        setTxState({ status: "success", txHash: hash });
        await refetch();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Wrap failed";
        setTxState({ status: "error", error: msg });
        return false;
      }
    },
    [address, writeContractAsync, refetch],
  );

  const unwrap = useCallback(
    async (amount: bigint): Promise<boolean> => {
      if (!address) return false;
      try {
        setTxState({ status: "unwrapping" });

        const hash = await writeContractAsync({
          address: WHYPE_ADDRESS,
          abi: WHYPE_ABI,
          functionName: "withdraw",
          args: [amount],
        });

        setTxState({ status: "unwrapping", txHash: hash });

        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { wagmiConfig } = await import("@/lib/wagmi");

        await waitForTransactionReceipt(wagmiConfig, { hash });

        setTxState({ status: "success", txHash: hash });
        await refetch();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unwrap failed";
        setTxState({ status: "error", error: msg });
        return false;
      }
    },
    [address, writeContractAsync, refetch],
  );

  return {
    nativeBalance,
    whypeBalance,
    wrap,
    unwrap,
    txState,
    resetTx,
    refetch,
  };
}
