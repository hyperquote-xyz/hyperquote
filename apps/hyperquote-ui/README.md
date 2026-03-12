# HyperQuote UI

A production-ready web interface for permissionless RFQ (Request-for-Quote) trading on HyperEVM.

## Overview

HyperQuote enables traders to get better execution than AMM pools for large trades by connecting directly with market makers. Quotes are signed off-chain and settled atomically on-chain.

### Key Features

- **RFQ vs AMM Comparison**: See exactly how much you save compared to AMM slippage
- **Two Trade Modes**: Exact-In ("I have X") and Exact-Out ("I want Y")
- **Atomic Settlement**: Fully on-chain, trustless execution on HyperEVM
- **Permissionless**: Anyone can trade or become a maker
- **Low Fees**: Only 2.5 bps (0.025%) protocol fee

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS + shadcn/ui components
- **Wallet**: wagmi + viem for HyperEVM
- **State**: React Query + React hooks
- **TypeScript**: Full type safety

## Getting Started

### Prerequisites

- Node.js 18+
- npm (or yarn / pnpm)
- A deployed `HyperEvmRfq` contract address on HyperEVM

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env.local

# 3. Edit .env.local — at minimum set the contract address:
#    NEXT_PUBLIC_RFQ_CONTRACT_ADDRESS=0xYourDeployedContract

# 4. Start dev server (runs preflight checks automatically)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Preflight Checks

The preflight script (`scripts/preflight.mjs`) runs automatically before `npm run dev` and `npm run build`. It verifies:

- `.env.local` exists
- Required env vars are set and valid (e.g. contract address is a non-zero 0x address)
- Recommended env vars are present (warnings only, non-blocking)

Run it standalone:

```bash
npm run preflight
```

### Health Check

Once running, verify the server is healthy:

```bash
curl http://localhost:3000/api/health
# → { "status": "ok", "timestamp": "...", "uptime": 12.3, ... }
```

### Environment Variables

Copy `.env.example` to `.env.local`. The example file is fully commented — here's the summary:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS` | **yes** | — | Deployed HyperEvmRfq (spot) contract |
| `NEXT_PUBLIC_CHAIN_ID` | no | `999999` | HyperEVM chain ID |
| `NEXT_PUBLIC_CHAIN_NAME` | no | `HyperEVM` | Display name |
| `NEXT_PUBLIC_RPC_URL` | no | `https://rpc.hyperevm.io` | JSON-RPC endpoint |
| `NEXT_PUBLIC_BLOCK_EXPLORER_URL` | no | `https://explorer.hyperevm.io` | Block explorer base URL |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no | — | WalletConnect project ID |
| `NEXT_PUBLIC_USE_RELAY` | no | `false` | Enable WebSocket relay |
| `NEXT_PUBLIC_RELAY_URL` | no | — | Relay WebSocket URL |
| `EXPLORER_API_KEY` | no | — | Etherscan-compatible API key |
| `EXPLORER_CHAIN_ID` | no | `999` | Chain ID for explorer API |
| `EXPLORER_API_BASE` | no | `https://api.etherscan.io/v2/api` | Explorer API base URL |

### npm Scripts

```bash
npm run preflight   # Check env vars (runs automatically with dev/build)
npm run dev         # Preflight + start development server
npm run build       # Preflight + production build
npm run start       # Start production server (no preflight — already built)
npm run lint        # Run ESLint
```

## Project Structure

```
scripts/
│   └── preflight.mjs       # Pre-start env var checker
src/
├── app/
│   ├── layout.tsx           # Root layout with providers
│   ├── page.tsx             # Landing page (+ live feed)
│   ├── swap/page.tsx        # Taker swap interface
│   ├── maker/page.tsx       # Maker dashboard (WebSocket)
│   ├── console/page.tsx     # Maker console (REST/SSE)
│   └── api/
│       ├── health/          # GET  /api/health
│       ├── rfq/             # POST /api/rfq (register)
│       │   │                # GET  /api/rfq?wallet= (count)
│       │   ├── [token]/     # GET  /api/rfq/:token (private lookup)
│       │   ├── detail/[id]/ # GET  /api/rfq/detail/:id
│       │   ├── quote/       # POST /api/rfq/quote
│       │   └── stream/      # GET  /api/rfq/stream (SSE)
│       └── explorer/        # GET  /api/explorer/contract-status
├── components/
│   ├── ui/                  # shadcn/ui base components
│   ├── Header.tsx           # Navigation header
│   ├── SwapInterface.tsx    # Main taker UI
│   ├── MakerInterface.tsx   # Maker dashboard
│   ├── TokenSelector.tsx    # Token selection dialog
│   ├── QuoteCard.tsx        # Quote display card
│   ├── ComparisonCard.tsx   # RFQ vs AMM comparison
│   ├── ExecutionPanel.tsx   # Approval + fill flow
│   └── JSONExchange.tsx     # Copy/paste quote transport
├── config/
│   ├── contracts.ts         # Contract ABI and address
│   ├── chains.ts            # HyperEVM chain config
│   └── tokens.ts            # Default token list
├── hooks/
│   ├── useRFQ.ts            # Core RFQ hooks
│   └── useCountdown.ts      # Expiry countdown hook
├── lib/
│   ├── rfqRegistry.ts       # Server-side RFQ state + SSE
│   ├── utils.ts             # Utility functions
│   ├── amm.ts               # AMM estimation
│   └── wagmi.ts             # Wagmi configuration
└── types/
    └── rfq.ts               # TypeScript types
```

## Demo Mode (V1)

In V1, quote transport uses a copy/paste JSON workflow:

### As a Taker:
1. Fill in trade details and click "Request Quote"
2. Copy the request JSON and send to makers (Discord, Telegram, etc.)
3. Paste received quote JSONs to view and compare
4. Select best quote and execute

### As a Maker:
1. Connect wallet and go to Maker page
2. Paste taker's request JSON
3. Enter your quoted price and sign
4. Copy the signed quote JSON and send back to taker

## V2 Roadmap: Relay Integration

The codebase is designed for easy transition to a WebSocket relay:

### Current Architecture (V1)
```
Taker ←→ Copy/Paste JSON ←→ Maker
              ↓
         HyperEvmRfq Contract
```

### Future Architecture (V2)
```
Taker ←→ WebSocket Relay ←→ Maker
              ↓
         HyperEvmRfq Contract
```

### Migration Steps:

1. **Create a Relay Service**
   ```typescript
   // src/lib/relay.ts
   export class QuoteRelay {
     private ws: WebSocket;
     
     connect(url: string) { /* ... */ }
     
     // Taker methods
     broadcastRequest(request: RFQRequest) { /* ... */ }
     subscribeToQuotes(requestId: string, callback: (quote: RFQQuote) => void) { /* ... */ }
     
     // Maker methods
     subscribeToRequests(callback: (request: RFQRequest) => void) { /* ... */ }
     sendQuote(quote: RFQQuote) { /* ... */ }
   }
   ```

2. **Update Hooks**
   ```typescript
   // In useTakerRFQ
   // Replace: manual JSON import
   // With: relay.subscribeToQuotes(requestId, importQuoteJSON)
   
   // In useMakerRFQ
   // Replace: manual JSON export
   // With: relay.sendQuote(quote)
   ```

3. **Remove JSONExchange Component**
   - Quotes flow automatically through the relay
   - UI shows real-time quote updates

## Smart Contract Integration

The UI integrates with `HyperEvmRfq.sol`:

### Key Functions Used

```solidity
// View functions
function makerNonce(address) external view returns (uint256);
function feePips() external view returns (uint32);
function quoteUsed(bytes32) external view returns (bool);

// Taker functions
function fillExactIn(Quote quote, bytes sig, uint256 minOut) external;
function fillExactOut(Quote quote, bytes sig, uint256 maxIn) external;

// Maker functions
function cancelAllQuotes() external;
```

### EIP-712 Signing

Makers sign quotes using EIP-712 typed data:

```typescript
const signature = await signTypedDataAsync({
  domain: {
    name: "HyperQuote",
    version: "1",
    chainId: hyperEVM.id,
    verifyingContract: RFQ_CONTRACT_ADDRESS,
  },
  types: {
    Quote: [
      { name: "kind", type: "uint8" },
      { name: "maker", type: "address" },
      // ... other fields
    ],
  },
  primaryType: "Quote",
  message: quoteData,
});
```

## AMM Comparison

The `src/lib/amm.ts` module provides AMM slippage estimation:

```typescript
// Currently: Mock implementation
// Future: Replace with real pool data from prjx.com/liquidity

const estimate = await estimateAMMOutput(tokenIn, tokenOut, amountIn);
// Returns: { amountOut, priceImpact, source, poolLiquidity }
```

To integrate real AMM data:
1. Fetch pool reserves from prjx.com API or on-chain
2. Calculate output using constant product formula
3. Include swap fees in calculation

## Customization

### Adding Tokens

Edit `src/config/tokens.ts`:

```typescript
export const DEFAULT_TOKENS: Token[] = [
  {
    address: "0x...",
    symbol: "TOKEN",
    name: "My Token",
    decimals: 18,
    logoUrl: "/tokens/token.svg",
  },
  // ... more tokens
];
```

### Styling

The theme is in `src/app/globals.css`. Modify CSS variables for colors:

```css
:root {
  --primary: 172 66% 50%; /* Teal accent */
  --background: 220 20% 6%; /* Dark background */
  /* ... */
}
```

## Scripts

```bash
npm run preflight   # Validate env vars
npm run dev         # Preflight + dev server
npm run build       # Preflight + production build
npm run start       # Start production server
npm run lint        # Run ESLint
```

## Security Considerations

- All trades settle atomically on-chain
- Signatures are verified against maker address
- Quotes have expiry timestamps
- MinOut/MaxIn constraints protect against bad fills
- Token allowance checks before fill

## License

MIT
