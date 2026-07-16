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
//?
//? Shared by BOTH vitest configs. The integration config used to omit this list,
//? which was survivable only because its single test imported core by RELATIVE
//? path; the first integration test to import `@luckystack/core` by SPECIFIER
//? would have silently run against dist — and, worse, split the config
//? registries across two module instances (the source-imported `startRouter`
//? reading a registry the dist-imported `registerDeployConfig` never wrote).
export const buildLuckystackAliases = (configUrl: URL): { find: RegExp; replacement: string }[] => {
  const tsconfigPath = fileURLToPath(new URL("./tsconfig.server.json", configUrl));
  const { config } = ts.parseConfigFileTextToJson(tsconfigPath, readFileSync(tsconfigPath, "utf8"));
  const paths = (config?.compilerOptions?.paths ?? {}) as Record<string, string[]>;
  const fromRoot = (p: string): string => fileURLToPath(new URL(p, configUrl));

  return Object.entries(paths)
    .filter(([key]) => key.startsWith("@luckystack/"))
    .map(([key, [target]]) => ({
      find: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      replacement: fromRoot(target ?? ""),
    }));
};
