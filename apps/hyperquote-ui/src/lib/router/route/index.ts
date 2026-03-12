/**
 * Route Module — Phase 6
 *
 * Re-exports for clean imports:
 *   import { findBestRoutes } from "@/lib/router/route";
 */

export type {
  RouteHop,
  CandidateRoute,
  EvaluatedRoute,
  RouteGenerationOptions,
} from "./types";

export {
  generateCandidateRoutes,
  evaluateRoute,
  findBestRoutes,
} from "./generator";
