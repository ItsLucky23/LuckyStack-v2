import { defineConfig } from "vitest/config";

//? Opt-in integration suite (`npm run test:integration`). Separate from the pure
//? unit run (`npm run test:unit`) because these tests touch a real Redis. Files
//? are named `*.integration.test.ts` and are EXCLUDED from the unit config.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["packages/*/src/**/*.integration.test.ts", "server/**/*.integration.test.ts"],
    environment: "node",
    //? Socket + Redis handshakes need headroom over the 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
