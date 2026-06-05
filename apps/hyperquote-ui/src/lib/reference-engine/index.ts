/**
 * Reference Engine — unified venue comparison and theoretical pricing
 *
 * Modules:
 * - ht.ts       — HT.xyz R1 aggregator adapter
 * - publicBestRoute.ts — best executable route selector
 * - theoretical.ts — fair market value computation
 */

export { fetchHtQuote, fetchHtQuoteDetailed } from "./ht";
export type { HtQuoteResult, HtVenueBreakdown } from "./ht";

export { selectPublicBestRoute } from "./publicBestRoute";
export type { PublicBestRoute, VenueCandidate } from "./publicBestRoute";

export { computeTheoretical } from "./theoretical";
export type { TheoreticalRef } from "./theoretical";
