# HyperQuote

> Request-for-Quote liquidity protocol for size-aware spot execution.

Monorepo for the HyperQuote protocol: spot RFQ, options, maker SDK, and market terminal.

## Structure

```
apps/hyperquote-ui/       Next.js web UI
packages/sdk-maker/       Maker SDK (TypeScript + ethers)
services/relay/           WebSocket relay server
services/terminal-api/    Terminal REST API
services/terminal-ingest/ Terminal ingestion workers
contracts/options/        Solidity contracts (Foundry)
docs/                     Documentation
```

## Quick start

```bash
npm install
cp apps/hyperquote-ui/.env.example apps/hyperquote-ui/.env.local
npm run dev:ui
```

See [docs/LocalDev.md](docs/LocalDev.md) for full local development setup.

## Work areas & isolation rules

See [docs/WORK_AREAS.md](docs/WORK_AREAS.md) for folder boundaries, feature
isolation rules, and contribution guardrails.

## Commands

| Command | Description |
|---|---|
| `npm run dev:ui` | Start UI in dev mode (port 3000) |
| `npm run dev:all` | Start relay + terminal-api + UI concurrently |
| `npm run lint:ui` | ESLint (includes feature isolation checks) |
| `npm run typecheck:all` | Type-check all workspaces |
| `npm run build:all` | Production build for all workspaces |
| `npm run check:all` | Lint + typecheck + build (full CI check) |
| `npm run test:sdk` | Run SDK tests |
| `npm run clean` | Remove all build artifacts |
