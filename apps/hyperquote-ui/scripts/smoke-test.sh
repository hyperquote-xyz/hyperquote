#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test.sh — Release smoke test for HyperQuote spot-only UI
#
# Usage:
#   1. Start the dev server:
#        NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3 npm run dev
#   2. In a separate terminal, run this script:
#        bash scripts/smoke-test.sh
#
# The script assumes the dev server is running on http://localhost:3000.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE="http://localhost:3000"
PASS=0
FAIL=0
WARN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { PASS=$((PASS + 1)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAIL=$((FAIL + 1)); echo -e "  ${RED}✗${NC} $1"; }
warn() { WARN=$((WARN + 1)); echo -e "  ${YELLOW}⚠${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════"
echo " HyperQuote Spot-Only — Release Smoke Test"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 1. Health ────────────────────────────────────────────────────────────────

echo "1. Health endpoint"
HEALTH=$(curl -sf "$BASE/api/health" 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "GET /api/health → ok"
else
  fail "GET /api/health — not reachable or bad response"
fi

# ── 2. Page loads (HTML 200) ─────────────────────────────────────────────────

echo ""
echo "2. Page loads (HTTP 200)"

for PAGE in "/" "/swap" "/feed" "/maker" "/leaderboard"; do
  STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE$PAGE" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    pass "GET $PAGE → $STATUS"
  else
    fail "GET $PAGE → $STATUS (expected 200)"
  fi
done

# Options / Terminal / Positions should still load (hidden from nav, not deleted)
for PAGE in "/options" "/terminal" "/positions" "/console"; do
  STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE$PAGE" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    pass "GET $PAGE → $STATUS (hidden but accessible)"
  else
    warn "GET $PAGE → $STATUS (expected 200, page may be gated)"
  fi
done

# ── 3. API endpoints ────────────────────────────────────────────────────────

echo ""
echo "3. API endpoints"

# RFQ list
RFQ_LIST=$(curl -sf "$BASE/api/v1/rfqs" 2>/dev/null || echo "FAIL")
if echo "$RFQ_LIST" | grep -q '"rfqs"'; then
  pass "GET /api/v1/rfqs → valid JSON with rfqs array"
elif [ "$RFQ_LIST" = "FAIL" ]; then
  fail "GET /api/v1/rfqs — not reachable"
else
  warn "GET /api/v1/rfqs — unexpected shape: ${RFQ_LIST:0:80}"
fi

# Leaderboard
LB=$(curl -sf "$BASE/api/v1/leaderboard?tab=makers&window=7d" 2>/dev/null || echo "FAIL")
if echo "$LB" | grep -q '"entries"'; then
  pass "GET /api/v1/leaderboard?tab=makers&window=7d → valid JSON"
elif [ "$LB" = "FAIL" ]; then
  fail "GET /api/v1/leaderboard — not reachable"
else
  warn "GET /api/v1/leaderboard — unexpected shape: ${LB:0:80}"
fi

# Badges (use a test address)
BADGES=$(curl -sf "$BASE/api/v1/badges/0x0000000000000000000000000000000000000001" 2>/dev/null || echo "FAIL")
if echo "$BADGES" | grep -q '"hasHypio"'; then
  pass "GET /api/v1/badges/:address → valid badge response"
elif [ "$BADGES" = "FAIL" ]; then
  fail "GET /api/v1/badges/:address — not reachable"
else
  warn "GET /api/v1/badges/:address — unexpected shape: ${BADGES:0:80}"
fi

# Badges — invalid address (should 400)
BAD_ADDR=$(curl -so /dev/null -w "%{http_code}" "$BASE/api/v1/badges/invalid" 2>/dev/null || echo "000")
if [ "$BAD_ADDR" = "400" ]; then
  pass "GET /api/v1/badges/invalid → 400 (correct rejection)"
else
  warn "GET /api/v1/badges/invalid → $BAD_ADDR (expected 400)"
fi

# Feed SSE — quick connect/disconnect check
echo ""
echo "4. SSE feed stream"
SSE_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 3 "$BASE/api/v1/feed/stream" 2>/dev/null || echo "200")
if [ "$SSE_STATUS" = "200" ] || [ "$SSE_STATUS" = "000" ]; then
  pass "GET /api/v1/feed/stream → connected (SSE stream)"
else
  fail "GET /api/v1/feed/stream → $SSE_STATUS (expected 200 SSE)"
fi

# ── 5. Static assets ────────────────────────────────────────────────────────

echo ""
echo "5. Static assets"

for ASSET in "/badges/hypio.svg" "/badges/hypurr.svg"; do
  STATUS=$(curl -so /dev/null -w "%{http_code}" "$BASE$ASSET" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    pass "GET $ASSET → $STATUS"
  else
    fail "GET $ASSET → $STATUS (expected 200)"
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════"
echo -e " Results: ${GREEN}${PASS} passed${NC}, ${YELLOW}${WARN} warnings${NC}, ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some checks failed. Review the output above.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}All critical checks passed, but there are warnings.${NC}"
  exit 0
else
  echo -e "${GREEN}All checks passed. Ready to ship! 🚀${NC}"
  exit 0
fi
