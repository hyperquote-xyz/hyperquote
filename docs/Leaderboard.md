# Liquidity League — Leaderboard UX Spec

> Route: `/leaderboard`
> API: `GET /api/v1/leaderboard`, `GET /api/v1/leaderboard/me`

---

## Design Principles

- **Institutional, not gamified**: Clean data table, no animations, no achievements
- **Data-dense**: Show meaningful metrics, not vanity stats
- **Wallet-aware**: "My Rank" card when connected, graceful fallback when not

---

## Page Layout

### Header
- **Title**: "Liquidity League" with Trophy icon (lucide `Trophy`)
- **Subtitle**: "Top performers in the HyperQuote RFQ ecosystem"

### Controls Bar
- **Tabs** (left): Makers | Takers — uses existing `Tabs`/`TabsList`/`TabsTrigger` pattern
- **Time Range** (right): 7D | 30D | All — three `Button` variants (default/outline)

### My Rank Card (conditional)
- Shown **above the table** when wallet connected
- Compact horizontal `Card` with:
  - Rank badge (gold/silver/bronze for top 3, plain for others)
  - Formatted address + BadgePills
  - Points (post-boost)
  - Filled Notional
  - Fill Count
- **Not connected**: Hidden entirely (no CTA to connect)
- **Connected but no fills**: "Complete your first RFQ swap to appear on the Liquidity League"
- Data from `GET /api/v1/leaderboard/me?address=...&tab=...&window=...`

### Leaderboard Table

#### Columns — Makers Tab
| Column | Alignment | Responsive | Format |
|--------|-----------|------------|--------|
| Rank | Left | Always | #1 (badge for top 3) |
| Address | Left | Always | `formatAddress()` + link to `/profile/[addr]` |
| Boost | Left | `hidden sm:table-cell` | BadgePills component |
| Points | Right | Always | Comma-separated integer |
| Filled Notional | Right | `hidden sm:table-cell` | `$X,XXX` |
| Avg Improvement | Right | `hidden md:table-cell` | `+X bps` / `0 bps` / `-X bps` |
| Fills | Right | `hidden md:table-cell` | Integer |
| Kill Rate | Right | `hidden lg:table-cell` | `X%` or `—` |

#### Columns — Takers Tab
Same as Makers but **without Kill Rate** column.

### Row Interaction
- **Hover**: `hover:bg-muted/30` (existing)
- **Click**: Opens a `Sheet` (right drawer) with address details

### Detail Sheet (on row click)
- **Header**: Full checksummed address + copy-to-clipboard button
- **Badge row**: BadgePills with boost multiplier text
- **Stats grid** (2×3):
  - Points (post-boost)
  - Filled Notional
  - Fill Count
  - Avg Improvement
  - Kill Rate (makers only)
  - Boost Multiplier
- **Footer**: Link to `/profile/[address]` → "View Full Profile →"

### Empty State
- Trophy icon (muted, large)
- "No activity yet"
- "Complete RFQ swaps to earn points and appear on the leaderboard."
- CTA button: "Start Trading →" linking to `/swap`

### Footer Text
- `"{N} {makers|takers} active in the last {window}"`
- Remove the old "Boost applies to points (coming soon)" text — boost is now live

---

## API Endpoints

### `GET /api/v1/leaderboard`

**Query params:**
| Param | Values | Default |
|-------|--------|---------|
| `tab` (or `role`) | `makers` / `takers` | `makers` |
| `window` | `7d` / `30d` / `all` | `7d` |
| `cursor` | Address string (optional) | — |

**Response:**
```json
{
  "tab": "makers",
  "window": "7d",
  "entries": [
    {
      "rank": 1,
      "address": "0x...",
      "points": 1250,
      "rawPoints": 625,
      "volume": 150000.50,
      "fills": 42,
      "avgImprovementBps": 12,
      "cancelRate": 0.05,
      "boostMultiplier": 2.0
    }
  ],
  "totalParticipants": 87,
  "hasMore": false
}
```

### `GET /api/v1/leaderboard/me`

**Query params:**
| Param | Values | Default |
|-------|--------|---------|
| `address` | `0x...` (required) | — |
| `tab` | `makers` / `takers` | `makers` |
| `window` | `7d` / `30d` / `all` | `7d` |

**Response:**
```json
{
  "rank": 15,
  "entry": {
    "rank": 15,
    "address": "0x...",
    "points": 320,
    "rawPoints": 256,
    "volume": 45000,
    "fills": 8,
    "avgImprovementBps": 7,
    "cancelRate": 0.0,
    "boostMultiplier": 1.25
  },
  "totalParticipants": 87
}
```

If not ranked: `{ "rank": null, "entry": null, "totalParticipants": 87 }`

---

## Resilience

- Missing badge data → default boost 1.0 (no penalty)
- Missing cancel rate data → `cancelRate: null` (display as "—")
- API error → show error message + "Retry" button (existing pattern)
- No wallet connected → hide My Rank card entirely (no error)
