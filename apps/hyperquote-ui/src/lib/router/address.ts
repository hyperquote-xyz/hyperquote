/**
 * Address Normalization — Audit Fix #1
 *
 * Canonical address format: **lowercase hex**.
 *
 * Why lowercase (not EIP-55 checksum)?
 *   - Prisma/SQLite does case-sensitive string matching on PK lookups.
 *   - getAddress() from viem produces mixed-case checksummed addresses.
 *   - If seed data stores lowercase but scanner stores checksummed,
 *     FK lookups silently fail → no routes found.
 *   - Lowercase is the simplest canonical form that never disagrees
 *     with itself across different sources.
 *
 * Rule: Every address MUST pass through `normalizeAddress()` before
 * being written to the DB or used in a DB query.
 */

/**
 * Normalise an Ethereum address to lowercase canonical form.
 * Validates basic format (0x + 40 hex chars) and lowercases.
 *
 * @param address — raw address string (any case)
 * @returns lowercase 0x-prefixed address
 * @throws if address is not a valid hex address
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();

  // Zero address passthrough
  if (trimmed === "0x0000000000000000000000000000000000000000") {
    return trimmed;
  }

  // Basic validation: 0x + 40 hex characters
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`Invalid Ethereum address: ${trimmed}`);
  }

  return trimmed.toLowerCase();
}

/**
 * Normalise an array of addresses.
 */
export function normalizeAddresses(addresses: string[]): string[] {
  return addresses.map(normalizeAddress);
}
