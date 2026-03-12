import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// ── Shared root-level components that any feature may import ──────────
// Everything else at src/components/*.tsx is considered swap-specific.
const SHARED_ROOT_COMPONENTS = [
  "./TokenSelector.tsx",
  "./Header.tsx",
  "./Providers.tsx",
  "./TakerBadge.tsx",
  "./index.ts",
];

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ── Ignore generated files ────────────────────────────────────────────
  { ignores: ["src/generated/**"] },

  // ── Next.js defaults ──────────────────────────────────────────────────
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ── Relax pre-existing violations from v2 codebase ────────────────────
  // These rules surface ~70 pre-existing issues. Disable them to keep the
  // lint baseline clean — tighten later in a dedicated cleanup PR.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  // Console page is a debug tool with a pre-existing conditional hook call.
  {
    files: ["src/app/console/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // ── Feature-isolation guardrails ──────────────────────────────────────
  //
  // Five UI features with hard boundaries:
  //   swap      — root-level components (SwapInterface, ExecutionPanel, etc.)
  //   options   — components/options/
  //   terminal  — components/terminal/
  //   positions — components/positions/
  //   maker     — components/maker/
  //
  // Shared resources any feature may import:
  //   components/ui/**    — design-system primitives
  //   components/TokenSelector, Header, Providers — shared root components
  //   types/**            — TypeScript types
  //   config/**           — chain/token/contract config
  //   lib/utils.ts        — universal formatting helpers
  //   lib/wagmi.ts        — wallet config
  //   lib/db.ts           — Prisma client
  //   lib/explorer.ts     — contract verification
  //   lib/rfqRegistry.ts  — RFQ registry
  //   hooks/useCountdown  — shared countdown hook
  //   hooks/useRFQ        — shared RFQ hook (taker + maker)
  //   hooks/useUsdEstimate — shared USD estimation
  //

  // ── Zone rules for feature subdirectories (options, terminal, positions, maker)
  {
    files: ["src/**/*.{ts,tsx}"],
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // ─────────────────────────────────────────────────────────────
            // OPTIONS feature isolation
            // ─────────────────────────────────────────────────────────────
            {
              target: "./src/components/options",
              from: "./src/components",
              except: ["./ui", "./options", ...SHARED_ROOT_COMPONENTS],
              message:
                "Options components must not import from other features. Use @/components/ui or shared root components only.",
            },
            {
              target: "./src/components/options",
              from: "./src/lib/+(amm|hyperliquid|home-estimates|positions-utils|makerRelay).ts",
              message:
                "Options components must not import swap/positions/maker-specific libs.",
            },
            {
              target: "./src/components/options",
              from: "./src/hooks/+(useAMMBaseline|useAggregatorBench|useCoverage|useQuoteValidator|useTerminalApi|usePositions).ts",
              message:
                "Options components must not import swap/terminal/positions-specific hooks.",
            },

            // ─────────────────────────────────────────────────────────────
            // TERMINAL feature isolation
            // ─────────────────────────────────────────────────────────────
            {
              target: "./src/components/terminal",
              from: "./src/components",
              except: ["./ui", "./terminal", ...SHARED_ROOT_COMPONENTS],
              message:
                "Terminal components must not import from other features. Use @/components/ui or shared root components only.",
            },
            {
              target: "./src/components/terminal",
              from: "./src/lib/+(amm|hyperliquid|home-estimates|positions-utils|makerRelay|relay).ts",
              message:
                "Terminal components must not import swap/positions/maker-specific libs.",
            },
            {
              target: "./src/components/terminal",
              from: "./src/hooks/+(useAMMBaseline|useAggregatorBench|useCoverage|useQuoteValidator|usePositions).ts",
              message:
                "Terminal components must not import swap/positions-specific hooks.",
            },

            // ─────────────────────────────────────────────────────────────
            // POSITIONS feature isolation
            // ─────────────────────────────────────────────────────────────
            {
              target: "./src/components/positions",
              from: "./src/components",
              except: ["./ui", "./positions", ...SHARED_ROOT_COMPONENTS],
              message:
                "Positions components must not import from other features. Use @/components/ui or shared root components only.",
            },
            {
              target: "./src/components/positions",
              from: "./src/lib/+(amm|hyperliquid|home-estimates|makerRelay|relay).ts",
              message:
                "Positions components must not import swap/maker-specific libs.",
            },
            {
              target: "./src/components/positions",
              from: "./src/hooks/+(useAMMBaseline|useAggregatorBench|useCoverage|useQuoteValidator|useTerminalApi).ts",
              message:
                "Positions components must not import swap/terminal-specific hooks.",
            },

            // ─────────────────────────────────────────────────────────────
            // MAKER feature isolation
            // ─────────────────────────────────────────────────────────────
            {
              target: "./src/components/maker",
              from: "./src/components",
              except: ["./ui", "./maker", ...SHARED_ROOT_COMPONENTS],
              message:
                "Maker components must not import from other features. Use @/components/ui or shared root components only.",
            },
            {
              target: "./src/components/maker",
              from: "./src/lib/+(amm|hyperliquid|home-estimates|options-protocol|positions-utils).ts",
              message:
                "Maker components must not import swap/options/positions-specific libs.",
            },
            {
              target: "./src/components/maker",
              from: "./src/hooks/+(useAMMBaseline|useAggregatorBench|useCoverage|useQuoteValidator|useTerminalApi|usePositions).ts",
              message:
                "Maker components must not import swap/terminal/positions-specific hooks.",
            },
          ],
        },
      ],
    },
  },

  // ── SWAP root-level component isolation ──────────────────────────────
  // Separate config block uses `files` glob to target only root-level
  // component .tsx files (not in subdirectories).
  // MakerInterface.tsx is excluded — it's the maker feature entry point.
  {
    files: ["src/components/*.tsx"],
    ignores: ["src/components/MakerInterface.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/options/*", "@/components/options"],
              message: "Swap/root components must not import from options feature.",
            },
            {
              group: ["@/components/terminal/*", "@/components/terminal"],
              message: "Swap/root components must not import from terminal feature.",
            },
            {
              group: ["@/components/positions/*", "@/components/positions"],
              message: "Swap/root components must not import from positions feature.",
            },
            {
              group: ["@/lib/options-protocol", "@/lib/options-protocol/*"],
              message: "Swap/root components must not import options-protocol lib.",
            },
            {
              group: ["@/lib/positions-utils", "@/lib/positions-utils/*"],
              message: "Swap/root components must not import positions-utils lib.",
            },
            {
              group: ["@/lib/makerRelay", "@/lib/makerRelay/*"],
              message: "Swap/root components must not import makerRelay lib.",
            },
            {
              group: ["@/hooks/useTerminalApi"],
              message: "Swap/root components must not import terminal-specific hooks.",
            },
            {
              group: ["@/hooks/usePositions"],
              message: "Swap/root components must not import positions-specific hooks.",
            },
          ],
        },
      ],
    },
  },
];
