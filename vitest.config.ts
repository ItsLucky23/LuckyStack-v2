import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  //? Native Vite 8 tsconfig-path resolution (mirrors vite.config.ts). Replaces
  //? the removed `vite-tsconfig-paths` plugin so `@luckystack/*` aliases resolve
  //? without a separate dependency.
  resolve: {
    tsconfigPaths: true,
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
