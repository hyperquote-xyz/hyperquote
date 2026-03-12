/**
 * Shared constants for Feed components (FeedTable + RfqDetailDrawer).
 */

import type { FeedRfqStatus } from "@/hooks/useFeedStream";

export const STATUS_BADGE: Record<
  FeedRfqStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline";
    className?: string;
  }
> = {
  OPEN: {
    label: "Open",
    variant: "default",
    className: "bg-teal-500/90 text-white border-transparent",
  },
  QUOTED: { label: "Quoted", variant: "warning" },
  FILLED: { label: "Filled", variant: "success" },
  EXPIRED: { label: "Expired", variant: "secondary" },
  KILLED: { label: "Killed", variant: "secondary" },
};
