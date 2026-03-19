"use client";

import { useState, useCallback, useRef } from "react";
import { Token } from "@/types";
import { toast } from "@/components/ui/use-toast";
import { ALL_TOKENS, DEFAULT_TOKENS } from "@/config/tokens";
import { APPROVED_TOKENS, isApprovedToken, APPROVED_STABLE_SYMBOLS } from "@/config/approvedTokens";
import { getContractStatus, ContractStatus } from "@/lib/explorer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  Search,
  Copy,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn, safeSymbol, safeName } from "@/lib/utils";

/**
 * Deterministic background colour for a token symbol — generates a muted
 * hue based on a simple char-code hash so every token gets a unique pill.
 */
function symbolHue(sym: string): string {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 55%)`;
}

/** Token icon with onError fallback to coloured initial letter */
function TokenIcon({ token, size = "md" }: { token: Token; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => setFailed(true), []);

  const imgClass = size === "sm" ? "w-4 h-4 rounded-full" : "w-5 h-5 rounded-full";
  const wrapClass = size === "sm" ? "w-4 h-4 text-[9px]" : "w-5 h-5 text-[10px]";

  if (token.logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logoUrl}
        alt={safeSymbol(token)}
        className={imgClass}
        onError={handleError}
      />
    );
  }

  // Fallback — coloured circle with the first letter of the symbol
  const sym = safeSymbol(token);
  return (
    <span
      className={cn(wrapClass, "rounded-full flex items-center justify-center font-bold text-white select-none leading-none")}
      style={{ backgroundColor: symbolHue(sym) }}
      aria-label={sym}
    >
      {sym.charAt(0)}
    </span>
  );
}

interface TokenSelectorProps {
  selectedToken: Token | null;
  onSelect: (token: Token) => void;
  excludeToken?: Token | null;
  label?: string;
  /**
   * "rfq" — Only show approved launch tokens (no custom, no unverified toggle).
   * "full" (default) — Show full token universe with unverified toggle + custom address.
   */
  mode?: "rfq" | "full";
}

export function TokenSelector({
  selectedToken,
  onSelect,
  excludeToken,
  label = "Select token",
  mode = "full",
}: TokenSelectorProps) {
  const isRfqMode = mode === "rfq";
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [showUnverified, setShowUnverified] = useState(false);

  // --- Explorer verification (on-demand, not per-row) ---
  const explorerCache = useRef<Map<string, ContractStatus>>(new Map());
  const [explorerLoading, setExplorerLoading] = useState<Set<string>>(new Set());
  const [, forceRender] = useState(0);

  /** Fire-and-forget explorer check; result lands in explorerCache ref */
  const checkExplorer = useCallback(async (addr: string) => {
    const key = addr.toLowerCase();
    if (explorerCache.current.has(key)) return;            // already cached
    if (key === "0x0000000000000000000000000000000000000000") return; // native token

    setExplorerLoading((prev) => new Set(prev).add(key));
    try {
      const status = await getContractStatus(addr);
      explorerCache.current.set(key, status);
    } finally {
      setExplorerLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      forceRender((n) => n + 1);                           // re-render to show result
    }
  }, []);

  /** Lookup cached explorer result (undefined = not yet checked) */
  const explorerResult = (addr: string): ContractStatus | undefined =>
    explorerCache.current.get(addr.toLowerCase());

  // --- address helpers ---
  const NATIVE_ADDR = "0x0000000000000000000000000000000000000000";
  const isNative = (a: string) => a.toLowerCase() === NATIVE_ADDR;
  const hyperevmScanUrl = (a: string) =>
    isNative(a)
      ? `https://hyperevmscan.io/address/${a.toLowerCase()}`
      : `https://hyperevmscan.io/token/${a.toLowerCase()}`;

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      toast({ title: "Copied", description: addr });
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy address",
        variant: "destructive",
      });
    }
  };

  const sourceTokens = isRfqMode
    ? (APPROVED_TOKENS as Token[])
    : showUnverified ? ALL_TOKENS : DEFAULT_TOKENS;

  /** Is this the excluded (already-selected opposite) token? */
  const isExcluded = (token: Token) =>
    !!excludeToken && token.address.toLowerCase() === excludeToken.address.toLowerCase();

  const filteredTokens = sourceTokens
    .filter((token) => {
      // In RFQ mode: keep excluded token in list (shown as disabled).
      // In full mode: hide it entirely (original behavior).
      if (isExcluded(token) && !isRfqMode) return false;
      if (!search) return true;
      return (
        token.symbol.toLowerCase().includes(search.toLowerCase()) ||
        token.name.toLowerCase().includes(search.toLowerCase()) ||
        token.address.toLowerCase().includes(search.toLowerCase())
      );
    })
    // In RFQ mode, sort stables first for guided pair selection
    .sort((a, b) => {
      if (!isRfqMode) return 0;
      const aStable = APPROVED_STABLE_SYMBOLS.has(a.symbol.toUpperCase()) ? 0 : 1;
      const bStable = APPROVED_STABLE_SYMBOLS.has(b.symbol.toUpperCase()) ? 0 : 1;
      return aStable - bStable;
    });

  const isVerified = (t: any) => Boolean(t?.verified) && t?.tier !== "unverified";
  const isUnverified = (t: any) => t?.tier === "unverified" || t?.verified === false;

  const handleCustomToken = () => {
    if (customAddress && customAddress.startsWith("0x") && customAddress.length === 42) {
      const customToken: Token = {
        address: customAddress as `0x${string}`,
        symbol: "???",
        name: "Custom Token",
        decimals: 18,
      };
      onSelect(customToken);
      setOpen(false);
      setCustomAddress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-12 px-3 gap-2 min-w-[140px] justify-between",
            !selectedToken && "text-muted-foreground"
          )}
        >
          {selectedToken ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                  <TokenIcon token={selectedToken} size="sm" />
                </div>
                <span className="font-medium">{safeSymbol(selectedToken)}</span>
                {selectedToken.isNative && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">Native</Badge>
                )}
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </>
          ) : (
            <>
              <span>{label}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Token</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or paste address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Visibility toggle for token universe — hidden in RFQ mode */}
          {!isRfqMode && <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">Show unverified tokens</div>
              <div className="text-xs text-muted-foreground">
                Unverified tokens may be scams or misconfigured contracts.
              </div>
            </div>
            <label className="inline-flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={showUnverified}
                onChange={(e) => setShowUnverified(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm">Enable</span>
            </label>
          </div>}

          {/* Token List */}
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {filteredTokens.map((token) => {
              const excluded = isRfqMode && isExcluded(token);
              return (
              <button
                key={`${token.address.toLowerCase()}-${(token.symbol ?? "").toLowerCase()}`}
                disabled={excluded}
                onClick={() => {
                  if (excluded) return;
                  // Warn, but still allow selection.
                  if (isUnverified(token)) {
                    toast({
                      title: "Unverified token",
                      description: "Double-check the contract address before trading.",
                      variant: "destructive",
                    });
                  }
                  // Trigger explorer check on selection (fire-and-forget)
                  checkExplorer(token.address);
                  onSelect(token);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
                  excluded
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-muted/50",
                  selectedToken?.address === token.address && "bg-muted"
                )}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <TokenIcon token={token} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{safeSymbol(token)}</div>
                    {excluded && (
                      <Badge variant="outline" className="h-5 px-2 text-[10px] text-muted-foreground">Already selected</Badge>
                    )}
                    {!excluded && token.isNative && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Native</Badge>
                    )}
                    {!excluded && (isVerified(token) ? (
                      <Badge variant="secondary" className="h-5 px-2 text-xs">Verified</Badge>
                    ) : (
                      <Badge variant="destructive" className="h-5 px-2 text-xs">Unverified</Badge>
                    ))}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">{safeName(token)}</div>

                  {/* Address row */}
                  <div className="mt-2 text-xs text-muted-foreground">
                    {/* Full address, horizontally scrollable so it always shows in entirety */}
                    <div className="font-mono text-[11px] leading-snug bg-muted/40 rounded-md px-2 py-1 overflow-x-auto whitespace-nowrap">
                      {token.address}
                    </div>

                    {/* Actions */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          copyAddress(token.address);
                        }}
                        title="Copy address"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>

                      <a
                        href={hyperevmScanUrl(token.address)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open in HyperEVMScan"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>EVMScan</span>
                      </a>

                      {/* Explorer source-code check — on-demand, only for non-native tokens */}
                      {!isNative(token.address) && (() => {
                        const er = explorerResult(token.address);
                        const loading = explorerLoading.has(token.address.toLowerCase());

                        if (loading) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Checking…</span>
                            </span>
                          );
                        }
                        if (er) {
                          // Error / rate-limited → "Source: Unknown"
                          if (er.error) {
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="h-5 px-2 text-xs inline-flex items-center gap-1 text-muted-foreground cursor-default">
                                    <ShieldAlert className="h-3 w-3" />
                                    Source: Unknown
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Could not reach HyperEVMScan — try again later</TooltipContent>
                              </Tooltip>
                            );
                          }
                          return er.verified ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="h-5 px-2 text-xs inline-flex items-center gap-1 cursor-default">
                                  <ShieldCheck className="h-3 w-3" />
                                  Source: Verified
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Contract source code verified on HyperEVMScan</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="h-5 px-2 text-xs inline-flex items-center gap-1 text-muted-foreground cursor-default">
                                  <ShieldAlert className="h-3 w-3" />
                                  Source: Unverified
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Contract source code not verified on HyperEVMScan</TooltipContent>
                            </Tooltip>
                          );
                        }
                        // Not yet checked — show Check button
                        return (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              checkExplorer(token.address);
                            }}
                            title="Check source code on HyperEVMScan"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>Check source</span>
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </button>
              );
            })}

            {filteredTokens.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-4">No tokens found</p>
                {/* Custom address input — disabled in RFQ mode */}
                {!isRfqMode && (
                  <div className="space-y-2">
                    <Input
                      placeholder="Paste token address (0x...)"
                      value={customAddress}
                      onChange={(e) => setCustomAddress(e.target.value)}
                    />
                    <Button
                      size="sm"
                      onClick={handleCustomToken}
                      disabled={!customAddress || customAddress.length !== 42}
                      className="w-full"
                    >
                      Add Custom Token
                    </Button>
                  </div>
                )}
                {isRfqMode && (
                  <p className="text-xs text-muted-foreground/60">
                    Only approved launch tokens can be used for RFQ creation.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
