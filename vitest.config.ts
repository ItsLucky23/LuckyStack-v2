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
  },
});
