# Local Development Runbook

> Quick-start guide for running the HyperQuote monorepo locally.

## 1. One-time setup

```bash
# Clone and install (from repo root)
npm install

# Copy env templates
cp apps/hyperquote-ui/.env.example  apps/hyperquote-ui/.env.local
cp services/terminal-ingest/.env.example  services/terminal-ingest/.env
```

Edit each `.env.local` / `.env` with values for your environment.
The UI falls back to localhost defaults in dev mode — you can skip most vars initially.

## 2. Postgres (required for terminal services)

`terminal-ingest` and `terminal-api` share a Postgres database.

```bash
# Start Postgres (Docker one-liner)
docker run -d --name hq-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hq_terminal \
  -p 5432:5432 \
  postgres:16

# Or if you already have Postgres running locally, just create the database:
createdb -U postgres hq_terminal
```

Apply the schema:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hq_terminal
npm run db:init --workspace=services/terminal-ingest
```

## 3. Start services

Open a separate terminal for each service. Start them in this order:

### 3a. Terminal Ingest (background data workers)

Ingests from Derive, HyperEVM, and Hyperliquid into Postgres.

```bash
# Requires DATABASE_URL + data source env vars (see services/terminal-ingest/.env.example)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hq_terminal
npm run dev:terminal-ingest
```

> **Optional in early dev.** If you don't need live market data, skip this and the terminal page will show empty tables.

### 3b. Terminal API (port 4200)

REST API serving ingested data. Requires the same `DATABASE_URL`.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hq_terminal
npm run dev:terminal-api
```

### 3c. Relay (port 8080)

WebSocket relay for RFQ/quote message passing between taker and maker.

```bash
npm run dev:relay
```

### 3d. UI (port 3000)

```bash
npm run dev:ui
```

Open [http://localhost:3000](http://localhost:3000).

## 4. Minimal env vars

### UI (`apps/hyperquote-ui/.env.local`)

| Variable | Required | Default (dev) |
|---|---|---|
| `NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS` | Prod only | `0x5FbDB...0aa3` |
| `NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS` | No | `0x0000...0000` |
| `NEXT_PUBLIC_RELAY_WS_URL` | No | `ws://127.0.0.1:8080` |
| `NEXT_PUBLIC_TERMINAL_API_URL` | No | `http://127.0.0.1:4200` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | No | — |

### Terminal services

| Variable | Required | Default |
|---|---|---|
| `DATABASE_URL` | **Yes** | — |
| `PORT` (terminal-api) | No | `4200` |
| `RELAY_PORT` (relay) | No | `8080` |

See `services/terminal-ingest/.env.example` for all ingest-specific vars.

## 5. Common failure modes

### Port already in use

```
Error: listen EADDRINUSE :::4200
```

Another process is on that port. Find and kill it:

```bash
lsof -ti:4200 | xargs kill -9   # terminal-api
lsof -ti:8080 | xargs kill -9   # relay
lsof -ti:3000 | xargs kill -9   # next dev
```

### Database connection refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

Postgres isn't running or the database doesn't exist:

```bash
# Check Docker container
docker ps | grep hq-postgres

# Restart if stopped
docker start hq-postgres

# Verify database exists
psql -U postgres -l | grep hq_terminal
```

### Missing `DATABASE_URL`

```
Error: DATABASE_URL environment variable is required
```

Set it before starting terminal services:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hq_terminal
```

Or add it to the service `.env` file.

### Preflight fails on missing `NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS`

In **dev mode** the preflight now warns and falls back to a default address. If you see a hard failure, you may be running with `NODE_ENV=production`. For local dev, don't set `NODE_ENV`.

### Next.js `prisma generate` errors

If you see Prisma client errors after a fresh install:

```bash
npx prisma generate --schema=apps/hyperquote-ui/prisma/schema.prisma
```

### ESLint feature-isolation errors

The monorepo has ESLint rules preventing cross-feature imports (e.g. options components importing swap-specific code). If you see `import/no-restricted-paths` errors, you've likely imported across a feature boundary — check `apps/hyperquote-ui/eslint.config.mjs` for the isolation zones.

## 6. Useful commands

```bash
# Full CI check (lint + typecheck + build, all workspaces)
npm run check:all

# Individual checks
npm run lint:ui          # ESLint
npm run typecheck:all    # tsc --noEmit for all workspaces
npm run build:all        # Full production build

# SDK tests
npm run test:sdk

# Clean build artifacts
npm run clean
```
