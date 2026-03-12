"use client";

import { useState, useEffect, useCallback } from "react";
import { secondsUntilExpiry } from "@/lib/utils";

/**
 * Hook for countdown timer functionality
 */
export function useCountdown(expiryTimestamp: number) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    secondsUntilExpiry(expiryTimestamp)
  );

  useEffect(() => {
    // Update immediately
    setSecondsLeft(secondsUntilExpiry(expiryTimestamp));

    // Update every second
    const interval = setInterval(() => {
      const remaining = secondsUntilExpiry(expiryTimestamp);
      setSecondsLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiryTimestamp]);

  const isExpired = secondsLeft <= 0;
  const isUrgent = secondsLeft > 0 && secondsLeft <= 10;
  const isExpiringSoon = secondsLeft > 10 && secondsLeft <= 30;

  return {
    secondsLeft,
    isExpired,
    isUrgent,
    isExpiringSoon,
  };
}

/**
 * Hook for managing quote expiry
 */
export function useQuoteExpiry(expiryTimestamp: number | undefined) {
  const { secondsLeft, isExpired, isUrgent, isExpiringSoon } = useCountdown(
    expiryTimestamp ?? 0
  );

  const formatTime = useCallback(() => {
    if (!expiryTimestamp || isExpired) return "Expired";
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    return `${secs}s`;
  }, [expiryTimestamp, isExpired, secondsLeft]);

  return {
    secondsLeft,
    isExpired,
    isUrgent,
    isExpiringSoon,
    formattedTime: formatTime(),
  };
}
