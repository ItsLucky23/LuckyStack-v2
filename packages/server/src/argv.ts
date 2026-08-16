//? Positional argv parser for the LuckyStack server boot. Replaces legacy
//? environment toggles with a single shape:
//?
//?   npm run server -- billing,vehicles 4001
//?
//? Arg 0 = comma-separated preset list (runtime maps merged across them).
//? Arg 1 = listen port (numeric).
//?
//? `applyServerArgv()` is called by the side-effect module
//? `@luckystack/server/parseArgv`, which consumers import as the FIRST line
//? of their `server.ts` so the parsed port lands in the browser-safe core/config
//? registry before `config.ts` evaluates its top-level OAuth callback base.

import { getPortOverride, registerPortOverride } from '@luckystack/core/config';
import { normalizeServerPort } from './portResolution';

export interface ParsedServerArgv {
  bundles: string[];
  port: number | null;
}

let parsedBundles: string[] = [];
let hasRun = false;

const PORT_PATTERN = /^\d+$/;

export const parseServerArgv = (argv: string[]): ParsedServerArgv => {
  if (argv.length > 2) {
    throw new Error(
      `[luckystack:argv] unexpected positional argument(s): "${argv.slice(2).join(' ')}". ` +
      `Usage: npm run server -- <bundle[,bundle...]> [port]`,
    );
  }

  const bundles = argv[0] && argv[0].length > 0
    ? [...new Set(argv[0].split(',').map((s) => s.trim()).filter(Boolean))]
    : [];

  let port: number | null = null;
  const portArg = argv[1];
  if (portArg !== undefined) {
    if (!PORT_PATTERN.test(portArg)) {
      throw new Error(
        `[luckystack:argv] port argument must be numeric, got: "${portArg}". ` +
        `Usage: npm run server -- <bundle[,bundle...]> [port]`,
      );
    }
    port = normalizeServerPort(portArg, 'port argument');
  }

  return { bundles, port };
};

export const applyServerArgv = (): void => {
  if (hasRun) return;
  hasRun = true;

  const result = parseServerArgv(process.argv.slice(2));
  parsedBundles = result.bundles;
  registerPortOverride(result.port);
};

export const getParsedBundles = (): string[] => parsedBundles;
export const getParsedPort = (): number | null => getPortOverride() ?? null;
