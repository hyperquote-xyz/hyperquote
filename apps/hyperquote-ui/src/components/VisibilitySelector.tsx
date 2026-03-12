"use client";

import { RFQVisibility } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface VisibilitySelectorProps {
  value: RFQVisibility;
  onChange: (value: RFQVisibility) => void;
}

interface VisibilityOption {
  value: RFQVisibility;
  label: string;
  description: string;
  icon: typeof Globe;
  badge?: string;
}

const OPTIONS: VisibilityOption[] = [
  {
    value: "public",
    label: "Public",
    description: "Your request will appear on the live RFQ feed. Any maker can respond.",
    icon: Globe,
    badge: "Recommended",
  },
  {
    value: "private",
    label: "Private",
    description:
      "Not broadcast to the public feed. Only selected makers can see it.",
    icon: Lock,
  },
];

export function VisibilitySelector({
  value,
  onChange,
}: VisibilitySelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {OPTIONS.map((option) => {
        const isSelected = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-200",
              "hover:border-primary/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isSelected
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-border/50 bg-muted/20"
            )}
          >
            {/* Selection indicator */}
            <div
              className={cn(
                "absolute top-3 right-3 h-4 w-4 rounded-full border-2 transition-all duration-200",
                isSelected
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/30"
              )}
            >
              {isSelected && (
                <div className="absolute inset-[3px] rounded-full bg-primary-foreground" />
              )}
            </div>

            {/* Icon + Label row */}
            <div className="flex items-center gap-2 pr-6">
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isSelected ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span
                className={cn(
                  "font-medium text-sm",
                  isSelected ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {option.label}
              </span>
              {option.badge && (
                <Badge
                  variant={isSelected ? "default" : "secondary"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {option.badge}
                </Badge>
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {option.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
