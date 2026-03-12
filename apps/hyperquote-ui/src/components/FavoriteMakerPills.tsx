"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatAddress } from "@/lib/utils";
import { Star, X, Plus } from "lucide-react";

interface FavoriteMakerPillsProps {
  favorites: `0x${string}`[];
  selectedFavorites: Set<string>;
  onToggle: (addr: `0x${string}`) => void;
  onRemove: (addr: `0x${string}`) => void;
  onSaveCurrentRecipients: () => void;
  onClear: () => void;
  hasManualRecipients: boolean;
}

export function FavoriteMakerPills({
  favorites,
  selectedFavorites,
  onToggle,
  onRemove,
  onSaveCurrentRecipients,
  onClear,
  hasManualRecipients,
}: FavoriteMakerPillsProps) {
  // Nothing to show if no favorites and no manual recipients to save
  if (favorites.length === 0 && !hasManualRecipients) return null;

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-medium text-muted-foreground">
            Favorite Makers
          </span>
        </div>
        <div className="flex items-center gap-1">
          {hasManualRecipients && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={onSaveCurrentRecipients}
            >
              <Plus className="h-3 w-3 mr-0.5" />
              Save to Favorites
            </Button>
          )}
          {selectedFavorites.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={onClear}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Pill row */}
      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {favorites.map((addr) => {
            const isActive = selectedFavorites.has(addr);
            return (
              <TooltipProvider key={addr}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-mono transition-all ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/50"
                      }`}
                      onClick={() => onToggle(addr)}
                    >
                      {formatAddress(addr, 4)}
                      <span
                        className="hidden group-hover:inline-flex ml-0.5 cursor-pointer"
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(addr);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            onRemove(addr);
                          }
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{addr}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Click to {isActive ? "deselect" : "select"} · Hover to
                      remove
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {favorites.length === 0 && hasManualRecipients && (
        <p className="text-[10px] text-muted-foreground">
          No favorites saved yet. Add addresses above, then save them.
        </p>
      )}
    </div>
  );
}
