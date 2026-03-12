/**
 * Centralized mock mode toggle.
 *
 * Controls dev-only mock data injection for both the Public RFQ Feed (/feed)
 * and the Liquidity League (/league).
 *
 * Activate with: NEXT_PUBLIC_MOCK_MODE=true next dev
 */
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";
