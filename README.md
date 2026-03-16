# HyperQuote

> RFQ liquidity protocol for size-aware spot execution on HyperEVM.

HyperQuote lets takers request competitive quotes directly from professional makers, compare execution against on-chain venues (HyperCore orderbook, HyperEVM DEX aggregators), and settle atomically on HyperEVM. The protocol is designed for large spot trades where slippage matters.

## Links

| | |
|---|---|
| **App** | [app.hyperquote.trade](https://app.hyperquote.trade) |
| **Docs** | [docs.hyperquote.trade](https://docs.hyperquote.trade) |
| **Telegram** | [t.me/hyperquote](https://t.me/hyperquote) |
| **GitHub** | [github.com/hyperquote-xyz/hyperquote](https://github.com/hyperquote-xyz/hyperquote) |

## Monorepo Structure

| Directory | Description |
|---|---|
| `apps/hyperquote-ui` | Next.js 15 web application (RFQ swap, feed, maker dashboard, venue comparison) |
| `apps/docs` | Documentation site |
| `packages/sdk-maker` | Maker SDK — TypeScript + ethers v6 for automated quoting |
| `packages/sdk-agent` | Agent SDK — programmatic RFQ interaction |
| `services/relay` | WebSocket relay server for real-time quote delivery |
| `services/alert-stream` | WebSocket alert stream for maker notifications |
| `services/telegram-bot` | Telegram bot for public RFQ feed broadcasting |
| `services/terminal-api` | Terminal REST API for market data |
| `services/terminal-ingest` | Terminal data ingestion workers |
| `contracts/spot-rfq` | Spot RFQ settlement contract (Foundry, solc 0.8.20) |
| `contracts/options` | Options contracts (Foundry, solc 0.8.24) |

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
npm install
```

### Run the UI

```bash
cp apps/hyperquote-ui/.env.example apps/hyperquote-ui/.env.local
npm run dev:ui
```

The app starts at `http://localhost:3000`.

### Run the docs site

```bash
npm run dev:docs
```

Docs start at `http://localhost:3001`.

### Run all services

```bash
npm run dev:all
```

Starts the relay, terminal API, and UI concurrently.

See [docs/LocalDev.md](docs/LocalDev.md) for full local development setup and [docs/WORK_AREAS.md](docs/WORK_AREAS.md) for folder boundaries and contribution guardrails.

## Commands

| Command | Description |
|---|---|
| `npm run dev:ui` | Start UI in dev mode (port 3000) |
| `npm run dev:docs` | Start docs site (port 3001) |
| `npm run dev:all` | Start relay + terminal-api + UI concurrently |
| `npm run lint:ui` | ESLint |
| `npm run typecheck:all` | Type-check all workspaces |
| `npm run build:all` | Production build for all workspaces |
| `npm run check:all` | Lint + typecheck + build (full CI check) |
| `npm run test:sdk` | Run SDK tests |
| `npm run clean` | Remove all build artifacts |

## Security

Do not commit `.env` files or secrets. Environment templates (`.env.example`) are provided in each workspace — copy them to `.env.local` and fill in your values. The `.gitignore` is configured to exclude all `.env` variants, databases, and build artifacts.

## License

[MIT](LICENSE)
