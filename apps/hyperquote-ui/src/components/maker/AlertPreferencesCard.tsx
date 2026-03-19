"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import {
  Bell,
  BellOff,
  Loader2,
  Save,
  Check,
  KeyRound,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Token definitions — derived from approved token registry
// ---------------------------------------------------------------------------

import { APPROVED_LAUNCH_ASSETS } from "@/config/approvedTokens";

interface AlertToken {
  symbol: string;
  /** Icon file in /public/tokens/ */
  iconFile: string;
  /** Lowercase 0x EVM address for the backend filter */
  address: string;
}

/** Launch tokens for alert filtering, derived from approved token registry. */
const ALERT_TOKENS: AlertToken[] = APPROVED_LAUNCH_ASSETS.map((t) => ({
  symbol: t.symbol,
  iconFile: t.localLogo,
  // For native HYPE, alerts track the wrapped address
  address: t.symbol === "HYPE"
    ? "0x5555555555555555555555555555555555555555"
    : t.address.toLowerCase(),
}));

// ---------------------------------------------------------------------------
// Min notional USD options
// ---------------------------------------------------------------------------

const MIN_SIZE_OPTIONS = [
  { value: "0", label: "No minimum" },
  { value: "10000", label: "$10,000" },
  { value: "25000", label: "$25,000" },
  { value: "100000", label: "$100,000" },
  { value: "250000", label: "$250,000" },
];

// ---------------------------------------------------------------------------
// Visibility options
// ---------------------------------------------------------------------------

type VisibilityOption = "all" | "public" | "private";

const VISIBILITY_OPTIONS: { value: VisibilityOption; label: string; description: string }[] = [
  { value: "all", label: "Both", description: "Public and private RFQs" },
  { value: "public", label: "Public RFQs", description: "Only publicly visible RFQs" },
  { value: "private", label: "Private RFQs routed to me", description: "Only RFQs where you're in allowedMakers" },
];

// ---------------------------------------------------------------------------
// API key storage
// ---------------------------------------------------------------------------

const API_KEY_STORAGE = "hq:agent-api-key";

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function saveApiKey(key: string) {
  try {
    localStorage.setItem(API_KEY_STORAGE, key);
  } catch {
    // Storage unavailable
  }
}

// ---------------------------------------------------------------------------
// Preferences shape (matches backend API)
// ---------------------------------------------------------------------------

interface AlertPreferences {
  enabled: boolean;
  tokens: string[];
  minNotionalUsd: number;
  visibility: VisibilityOption;
  side: "all" | "buy" | "sell";
  eventTypes: string[];
}

const DEFAULT_PREFS: AlertPreferences = {
  enabled: true,
  tokens: [],
  minNotionalUsd: 0,
  visibility: "all",
  side: "all",
  eventTypes: ["rfq.created", "rfq.filled"],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlertPreferencesCard() {
  // API key
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyVerified, setKeyVerified] = useState(false);

  // Preferences state
  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Load API key from localStorage on mount
  useEffect(() => {
    const stored = loadApiKey();
    if (stored) {
      setApiKey(stored);
    }
  }, []);

  // Fetch preferences when API key is set
  const fetchPrefs = useCallback(async (key: string) => {
    if (!key || !key.startsWith("hq_live_")) return;

    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/v1/agent/alerts/preferences", {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          setFetchError("Invalid API key");
          setKeyVerified(false);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setPrefs({
        enabled: data.enabled ?? true,
        tokens: data.tokens ?? [],
        minNotionalUsd: data.minNotionalUsd ?? 0,
        visibility: data.visibility ?? "all",
        side: data.side ?? "all",
        eventTypes: data.eventTypes ?? ["rfq.created", "rfq.filled"],
      });
      setKeyVerified(true);
      saveApiKey(key);
    } catch (err) {
      setFetchError("Failed to load preferences");
      setKeyVerified(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when stored key is loaded
  useEffect(() => {
    if (apiKey && apiKey.startsWith("hq_live_")) {
      fetchPrefs(apiKey);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save preferences
  const handleSave = useCallback(async () => {
    if (!apiKey) return;

    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/agent/alerts/preferences", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: prefs.enabled,
          tokens: prefs.tokens,
          minNotionalUsd: prefs.minNotionalUsd,
          visibility: prefs.visibility,
          side: prefs.side,
          eventTypes: prefs.eventTypes,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setSaved(true);
      toast({
        title: "Preferences saved",
        description: "Your alert preferences have been updated.",
      });

      // Reset the saved check after 3 seconds
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast({
        title: "Failed to save",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [apiKey, prefs]);

  // Token toggle
  const toggleToken = useCallback((address: string) => {
    setPrefs((prev) => {
      const has = prev.tokens.includes(address);
      return {
        ...prev,
        tokens: has
          ? prev.tokens.filter((t) => t !== address)
          : [...prev.tokens, address],
      };
    });
    setSaved(false);
  }, []);

  // Event type toggle
  const toggleEventType = useCallback((eventType: string) => {
    setPrefs((prev) => {
      const has = prev.eventTypes.includes(eventType);
      // Don't allow removing the last event type
      if (has && prev.eventTypes.length <= 1) return prev;
      return {
        ...prev,
        eventTypes: has
          ? prev.eventTypes.filter((t) => t !== eventType)
          : [...prev.eventTypes, eventType],
      };
    });
    setSaved(false);
  }, []);

  // Handle API key connect
  const handleConnect = useCallback(() => {
    if (apiKey) {
      fetchPrefs(apiKey);
    }
  }, [apiKey, fetchPrefs]);

  return (
    <div className="space-y-6">
      {/* ── API Key Section ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Agent API Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter your agent API key to load and save alert preferences.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="hq_live_..."
                className="h-9 text-sm font-mono pr-9"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyVerified(false);
                  setFetchError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <Button
              size="sm"
              variant={keyVerified ? "outline" : "default"}
              className="h-9 px-4"
              onClick={handleConnect}
              disabled={!apiKey || loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : keyVerified ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Connected
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
          {fetchError && (
            <p className="text-xs text-destructive">{fetchError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Preferences (shown only when connected) ─────────────────── */}
      {keyVerified && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Alert Preferences
              </span>
              {/* Enable/Disable toggle */}
              <button
                type="button"
                onClick={() => {
                  setPrefs((p) => ({ ...p, enabled: !p.enabled }));
                  setSaved(false);
                }}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200",
                  prefs.enabled
                    ? "bg-primary"
                    : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                    prefs.enabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent
            className={cn(
              "space-y-6 transition-opacity duration-200",
              !prefs.enabled && "opacity-50 pointer-events-none"
            )}
          >
            {/* ── Tokens ── */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Tokens
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Select tokens to filter alerts. No selection means all tokens.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALERT_TOKENS.map((token) => (
                  <TokenPill
                    key={token.symbol}
                    token={token}
                    isSelected={prefs.tokens.includes(token.address)}
                    onToggle={toggleToken}
                  />
                ))}
              </div>
              {prefs.tokens.length === 0 && (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  All tokens (no filter applied)
                </p>
              )}
            </div>

            {/* ── Min RFQ Size ── */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Minimum RFQ Size
              </Label>
              <Select
                value={String(prefs.minNotionalUsd)}
                onValueChange={(v) => {
                  setPrefs((p) => ({ ...p, minNotionalUsd: Number(v) }));
                  setSaved(false);
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MIN_SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Filter out small RFQs below this notional value.
              </p>
            </div>

            {/* ── Visibility ── */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Visibility
              </Label>
              <div className="space-y-1.5">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all duration-150",
                      prefs.visibility === opt.value
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/30 hover:border-border/60"
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors",
                        prefs.visibility === opt.value
                          ? "border-primary"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {prefs.visibility === opt.value && (
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {opt.description}
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.value}
                      checked={prefs.visibility === opt.value}
                      onChange={() => {
                        setPrefs((p) => ({ ...p, visibility: opt.value }));
                        setSaved(false);
                      }}
                      className="sr-only"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* ── Event Types ── */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Event Types
              </Label>
              <div className="space-y-1.5">
                {(["rfq.created", "rfq.filled"] as const).map((eventType) => (
                  <label
                    key={eventType}
                    className={cn(
                      "flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all duration-150",
                      prefs.eventTypes.includes(eventType)
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/30 hover:border-border/60"
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-md border-2 flex items-center justify-center transition-colors",
                        prefs.eventTypes.includes(eventType)
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {prefs.eventTypes.includes(eventType) && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium font-mono">
                        {eventType}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {eventType === "rfq.created"
                          ? "Alert when a new RFQ is created"
                          : "Alert when an RFQ is filled on-chain"}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={prefs.eventTypes.includes(eventType)}
                      onChange={() => toggleEventType(eventType)}
                      className="sr-only"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* ── Save Button ── */}
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={saving}
              variant={saved ? "outline" : "default"}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Preferences
                </>
              )}
            </Button>

            {/* ── Alert Preview ── */}
            <AlertPreview prefs={prefs} />
          </CardContent>
        </Card>
      )}

      {/* ── Not Connected Placeholder ───────────────────────────────── */}
      {!keyVerified && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <BellOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              Connect your agent API key to configure alerts
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Register an agent at{" "}
              <code className="text-[11px] bg-muted/50 px-1 py-0.5 rounded">
                POST /api/v1/agent/register
              </code>{" "}
              to get started.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertPreview — live preview of what alerts the user will receive
// ---------------------------------------------------------------------------

/** Reverse-lookup: address → symbol */
const ADDRESS_TO_SYMBOL = new Map(
  ALERT_TOKENS.map((t) => [t.address, t.symbol])
);

function AlertPreview({ prefs }: { prefs: AlertPreferences }) {
  // Build the summary sentence reactively from current prefs
  const summary = useMemo(() => {
    const parts: string[] = [];

    // Tokens
    if (prefs.tokens.length === 0) {
      parts.push("any token");
    } else {
      const names = prefs.tokens
        .map((addr) => ADDRESS_TO_SYMBOL.get(addr) ?? addr.slice(0, 8) + "\u2026")
        .join(" or ");
      parts.push(names);
    }

    // Min size
    if (prefs.minNotionalUsd > 0) {
      parts.push(`above $${prefs.minNotionalUsd.toLocaleString()}`);
    }

    // Visibility
    if (prefs.visibility === "public") {
      parts.push("public only");
    } else if (prefs.visibility === "private") {
      parts.push("private only");
    }

    // Event types
    const evtLabels = prefs.eventTypes.map((e) =>
      e === "rfq.created" ? "rfq.created" : "rfq.filled"
    );

    const tokenPart = `RFQs involving ${parts[0]}`;
    const qualifiers = parts.slice(1).join(", ");
    const eventPart = evtLabels.join(" and ");

    return `You will receive alerts for ${tokenPart}${qualifiers ? `, ${qualifiers}` : ""}, for ${eventPart}.`;
  }, [prefs]);

  // Build a mock alert based on current filter state
  const mockAlert = useMemo(() => {
    // Pick a representative token pair for the example
    const firstSelectedSymbol =
      prefs.tokens.length > 0
        ? ADDRESS_TO_SYMBOL.get(prefs.tokens[0]) ?? "TOKEN"
        : "PURR";
    const quoteToken = "USDH";

    const isCreated = prefs.eventTypes.includes("rfq.created");
    const vis =
      prefs.visibility === "private"
        ? "Private"
        : prefs.visibility === "public"
          ? "Public"
          : "Public";

    if (isCreated) {
      return {
        type: "rfq.created" as const,
        label: "New RFQ",
        sell: `100,000 ${quoteToken}`,
        buy: firstSelectedSymbol,
        visibility: vis,
        ttl: "60s",
      };
    }

    return {
      type: "rfq.filled" as const,
      label: "Filled",
      sell: `100,000 ${quoteToken}`,
      buy: `12,500 ${firstSelectedSymbol}`,
      visibility: vis,
      ttl: null,
    };
  }, [prefs.tokens, prefs.eventTypes, prefs.visibility]);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Alert Preview
        </span>
      </div>

      {/* Summary sentence */}
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        {summary}
      </p>

      {/* Mock alert card */}
      <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">
            {mockAlert.label}
          </span>
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 h-4"
          >
            {mockAlert.visibility}
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <div>
            <span className="text-muted-foreground/70">Sell:</span>{" "}
            <span className="text-foreground/80">{mockAlert.sell}</span>
          </div>
          <div>
            <span className="text-muted-foreground/70">Buy:</span>{" "}
            <span className="text-foreground/80">{mockAlert.buy}</span>
          </div>
          {mockAlert.ttl && (
            <div>
              <span className="text-muted-foreground/70">TTL:</span>{" "}
              <span className="text-foreground/80">{mockAlert.ttl}</span>
            </div>
          )}
        </div>
      </div>

      {/* Helper note */}
      <div className="flex items-start gap-1.5">
        <Info className="h-3 w-3 text-muted-foreground/50 mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
          Token filters match when the selected token appears as either
          the asset being sold or bought.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenPill — individual selectable token pill with icon
// ---------------------------------------------------------------------------

const TokenPill = memo(function TokenPill({
  token,
  isSelected,
  onToggle,
}: {
  token: AlertToken;
  isSelected: boolean;
  onToggle: (address: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onToggle(token.address)}
      className={cn(
        "flex items-center gap-2 h-9 px-3 rounded-lg border transition-all duration-150 select-none cursor-pointer",
        isSelected
          ? "border-primary/50 bg-primary/10 opacity-100"
          : "border-border/30 bg-card/30 opacity-60 hover:opacity-80"
      )}
    >
      {!imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/tokens/${token.iconFile}`}
          alt={token.symbol}
          className="w-5 h-5 rounded-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="w-5 h-5 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground">
          {token.symbol.charAt(0)}
        </span>
      )}
      <span className="text-xs font-medium whitespace-nowrap">
        {token.symbol}
      </span>
      {isSelected && (
        <Check className="h-3 w-3 text-primary" />
      )}
    </button>
  );
});
