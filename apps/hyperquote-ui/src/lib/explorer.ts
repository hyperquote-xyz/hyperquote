/**
 * Explorer verification client — calls our own API route which proxies
 * Etherscan v2 "getabi" for HyperEVM (chainId 999).
 *
 * Never throws. Returns a safe result object.
 */

export interface ContractStatus {
  address: string;
  verified: boolean;
  abiAvailable: boolean;
  fetchedAt: number;
  error?: string;
}

/**
 * Fetch contract verification status for a given address.
 * Calls `/api/explorer/contract-status?address=0x...`
 */
export async function getContractStatus(
  address: string
): Promise<ContractStatus> {
  const fallback: ContractStatus = {
    address: address.toLowerCase(),
    verified: false,
    abiAvailable: false,
    fetchedAt: Date.now(),
  };

  try {
    const res = await fetch(
      `/api/explorer/contract-status?address=${encodeURIComponent(address)}`
    );
    if (!res.ok) {
      return { ...fallback, error: `HTTP ${res.status}` };
    }
    const data: ContractStatus = await res.json();
    return data;
  } catch (err) {
    return {
      ...fallback,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
