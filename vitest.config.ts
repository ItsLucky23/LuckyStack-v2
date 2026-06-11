import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import ts from "typescript";

//? Resolve every @luckystack/* import to package SOURCE (not the built `dist`).
//? Vite's `tsconfigPaths` only applies the root path map to importers under
//? `src/`; a test under `packages/<pkg>/src` is governed by its own package
//? tsconfig (no paths) and so falls through to node_modules → `dist`. That made
//? the unit suite silently run against a STALE `dist` — 145 cryptic
//? "X is not a function" failures whenever `build:packages` was skipped. These
//? explicit aliases pin resolution to source. They mirror the exact path map in
//? tsconfig.server.json (the single source of truth) so test resolution and the
//? server build stay in lockstep; exact-match regexes keep `@luckystack/core`
//? from also swallowing `@luckystack/core/client`. Parsed via the TypeScript
//? JSONC reader because tsconfig.server.json carries comments + trailing commas.
const tsconfigPath = fileURLToPath(new URL("./tsconfig.server.json", import.meta.url));
const { config } = ts.parseConfigFileTextToJson(tsconfigPath, readFileSync(tsconfigPath, "utf8"));
const paths = (config?.compilerOptions?.paths ?? {}) as Record<string, string[]>;
const fromRoot = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const luckystackAliases = Object.entries(paths)
  .filter(([key]) => key.startsWith("@luckystack/"))
  .map(([key, [target]]) => ({
    find: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: fromRoot(target),
  }));

export default defineConfig({
  resolve: {
    //? Native Vite 8 tsconfig-path resolution (mirrors vite.config.ts), kept as
    //? the fallback for `src/`-rooted importers; the alias list above is what
    //? decouples `packages/*/src` tests from `dist`.
    tsconfigPaths: true,
    alias: luckystackAliases,
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "server/**/*.test.ts"],
    //? `*.integration.test.ts` need a real Redis — they live in the opt-in
    //? `npm run test:integration` suite (vitest.integration.config.ts), never
    //? in the pure unit run.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    environment: "node",
  },
});
