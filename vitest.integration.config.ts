import { defineConfig } from "vitest/config";
import { buildLuckystackAliases } from "./vitest.aliases";

//? Opt-in integration suite (`npm run test:integration`). Separate from the pure
//? unit run (`npm run test:unit`) because these tests touch a real Redis. Files
//? are named `*.integration.test.ts` and are EXCLUDED from the unit config.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    //? Same source-pinning as the unit config (see vitest.aliases.ts). Omitting
    //? it here was survivable only while the sole integration test imported core
    //? by RELATIVE path; a test that imports `@luckystack/core` by specifier
    //? would otherwise land on dist while its source-imported subject reads the
    //? source registry — two module instances, and the registration vanishes.
    alias: buildLuckystackAliases(import.meta.url),
  },
  test: {
    include: ["packages/*/src/**/*.integration.test.ts", "server/**/*.integration.test.ts"],
    environment: "node",
    //? Socket + Redis handshakes need headroom over the 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
