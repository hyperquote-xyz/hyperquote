# Work Areas & Isolation Rules

> This document defines the folder boundaries, import isolation rules, and
> contribution guardrails for the HyperQuote monorepo. All contributors
> (human and AI) must follow these rules.

---

## 1. Folder boundaries

Each top-level directory is an isolated work area with a single responsibility.

| Path | Scope | Language | Notes |
|---|---|---|---|
| `apps/hyperquote-ui/` | Web UI (Next.js) | TypeScript, React | All front-end code lives here. |
| `contracts/options/` | On-chain contracts | Solidity 0.8.24 | Foundry project. No TypeScript. |
| `packages/sdk-maker/` | Maker SDK | TypeScript | Standalone library. No React deps. |
| `services/relay/` | WebSocket relay server | TypeScript | Message passing between taker and maker. |
| `services/terminal-api/` | Terminal REST API | TypeScript | Reads from shared Postgres. |
| `services/terminal-ingest/` | Terminal ingestion workers | TypeScript | Writes to shared Postgres. |
| `docs/` | Documentation | Markdown | No executable code. |

**Rule:** Changes must stay within the work area relevant to the task.
A UI task should only touch `apps/hyperquote-ui/`. A contract change should only
touch `contracts/options/`. Cross-area changes require explicit justification.

---

## 2. UI feature isolation

Within `apps/hyperquote-ui/src/`, five features have hard import boundaries:

| Feature | Directory | Entry point |
|---|---|---|
| **Swap** (Spot RFQ) | `components/*.tsx` (root level) | `SwapInterface.tsx` |
| **Options** | `components/options/` | `OptionsInterface.tsx` |
| **Terminal** | `components/terminal/` | `TerminalInterface.tsx` |
| **Positions** | `components/positions/` | `PositionsInterface.tsx` |
| **Maker** | `components/maker/` | `MakerInterface.tsx` |

### What features CAN import (shared modules)

These are shared across all features:

- `components/ui/**` — design-system primitives (Button, Dialog, etc.)
- `components/TokenSelector.tsx` — token picker
- `components/Header.tsx` — app header
- `components/Providers.tsx` — React context providers
- `types/**` — TypeScript type definitions
- `config/**` — chain, token, and contract configuration
- `lib/utils.ts` — universal formatting helpers
- `lib/wagmi.ts` — wallet configuration
- `lib/db.ts` — Prisma client
- `lib/explorer.ts` — contract verification
- `lib/rfqRegistry.ts` — RFQ registry
- `hooks/useCountdown` — shared countdown hook
- `hooks/useRFQ` — shared RFQ hook
- `hooks/useUsdEstimate` — shared USD estimation

### What features CANNOT do

- **Options** cannot import from swap, terminal, positions, or maker components/libs/hooks.
- **Terminal** cannot import from swap, options, positions, or maker components/libs/hooks.
  - Exception: terminal may import `lib/options-protocol` (collateral math).
- **Positions** cannot import from swap, options, terminal, or maker components/libs/hooks.
- **Maker** cannot import from swap, options, terminal, or positions components/libs/hooks.
- **Swap** (root components) cannot import from options, terminal, positions, or maker components/libs/hooks.
  - Exception: `MakerInterface.tsx` sits at root level but belongs to the maker feature.

### Enforcement

These rules are enforced by ESLint at lint time via `import/no-restricted-paths` and
`no-restricted-imports`. See `apps/hyperquote-ui/eslint.config.mjs` for the exact
zone definitions. Run `npm run lint:ui` to check.

---

## 3. Cross-workspace boundaries

The npm workspaces are independent packages. They do not import from each other at
runtime:

- `@hyperquote/ui` does NOT import from `@hyperquote/sdk-maker` or any service.
- `@hyperquote/sdk-maker` does NOT import from the UI or services.
- Services (`relay`, `terminal-api`, `terminal-ingest`) do NOT import from each other.
- `terminal-api` and `terminal-ingest` share a Postgres database (not code imports).
- The UI communicates with services via HTTP/WebSocket at runtime, not import paths.

---

## 4. Claude guardrails

When working on this repo, Claude must follow these rules:

### 4a. Scope discipline

- **Before starting work**, identify which work area(s) the task touches.
- **Stay within scope.** A task targeting the UI should not modify contracts or services.
- If a task requires cross-area changes, call it out explicitly and get confirmation.

### 4b. File manifest

- **Always list files touched** at the end of each task, grouped by work area.
- Include the type of change: created, modified, or deleted.
- Example:
  ```
  Files changed:
    apps/hyperquote-ui/
      modified  src/components/options/OptionsInterface.tsx
      modified  src/hooks/usePositions.ts
      created   src/components/options/OptionChain.tsx
  ```

### 4c. No drive-by changes

- Do not "fix" unrelated issues discovered during a task.
- Do not upgrade dependencies unless the task requires it.
- Do not refactor folder structures unless explicitly asked.
- Do not rename or reorganize imports for style reasons.

### 4d. Verification

- After making changes, verify the relevant checks pass:
  - UI changes: `npm run lint:ui && npm run typecheck:ui`
  - Any workspace: `npm run typecheck:<workspace>`
  - Full check: `npm run check:all`
- Report the verification result in the summary.

### 4e. Import boundaries

- Before adding a new import, verify it doesn't violate the feature isolation rules
  documented in section 2 above.
- If the import is blocked by ESLint, do NOT disable the rule. Instead, either:
  1. Move the shared code to an allowed shared module, or
  2. Ask for guidance on the correct architecture.
