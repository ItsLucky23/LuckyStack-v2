import { defineConfig, configDefaults } from "vitest/config";
import { buildLuckystackAliases } from "./vitest.aliases";

export default defineConfig({
  resolve: {
    //? Native Vite 8 tsconfig-path resolution (mirrors vite.config.ts), kept as
    //? the fallback for `src/`-rooted importers; the alias list is what
    //? decouples `packages/*/src` tests from `dist` — see vitest.aliases.ts.
    tsconfigPaths: true,
    alias: buildLuckystackAliases(import.meta.url),
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "server/**/*.test.ts"],
    //? `*.integration.test.ts` need a real Redis — they live in the opt-in
    //? `npm run test:integration` suite (vitest.integration.config.ts), never
    //? in the pure unit run.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    environment: "node",
    //? Vitest's 5s default is wrong for this repo. The devkit typeMap suite
    //? (8 files today: tsProgram, transportInput, wireProjection*, extractors*,
    //? goldenRouteTypes) drives the real TypeScript compiler — each file builds
    //? its own `ts.Program` over `tsconfig.server.json`, because vitest gives
    //? every file its own module registry and `getServerProgram`'s cache cannot
    //? cross that boundary. Individual cases there measure 1.5-2.7s on an IDLE
    //? machine; under full-suite parallel load that regularly crossed 5s and
    //? failed roughly one run in three. That is an infrastructure cost, not a
    //? hung test, and it was failing CI on work unrelated to the change.
    //?
    //? Set globally rather than per-file: the timeout is a hang-detector, not
    //? an assertion, and a new typeMap test would silently inherit the old
    //? 5s trap. The tradeoff is that a genuinely hung test anywhere reports
    //? after 30s instead of 5s — runtime for passing tests is unchanged.
    testTimeout: 30_000,
  },
});
