#!/usr/bin/env node
//? `luckystack-router` CLI. Boots a router instance after side-effect-
//? importing the consumer's compiled `deploy.config.js` and
//? `services.config.js` so their `registerDeployConfig` /
//? `registerServicesConfig` calls populate `@luckystack/core` registries
//? before `startRouter()` reads them.
//?
//? Designed for production deployments where the router runs as its own
//? container alongside one or more backend instances. The consumer ships
//? the same compiled config files the backend uses, then runs:
//?
//?   npx luckystack-router \
//?     --deploy ./dist/deploy.config.js \
//?     --services ./dist/services.config.js \
//?     --env production \
//?     [--preset api] \
//?     [--port 4000] \
//?     [--no-shared-health]
//?
//? Dev mode runs against the source files via `tsx`:
//?   npx tsx node_modules/@luckystack/router/dist/cli.js \
//?     --deploy ./deploy.config.ts --services ./services.config.ts --env development

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { startRouter } from './startRouter';

interface CliArgs {
  deploy: string | null;
  services: string | null;
  env: string;
  preset: string | null;
  port: number | null;
  sharedHealth: boolean;
}

//? Parse a numeric CLI flag value. `Number('abc')` is `NaN` (not null), which
//? would otherwise flow downstream and silently misbehave: a NaN `--port` makes
//? `server.listen(NaN)` pick a random ephemeral port (operator believes it's on
//? 4000). Reject unparseable values loudly instead of silently degrading.
const parseNumericFlag = (raw: string | undefined, flag: string): number | null => {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    process.stderr.write(`[luckystack-router] ${flag} expects a number, got: ${raw}\n`);
    process.exit(2);
  }
  return value;
};

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args: CliArgs = {
    deploy: null,
    services: null,
    env: process.env.NODE_ENV ?? 'development',
    preset: null,
    port: null,
    sharedHealth: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next: string | undefined = i + 1 < argv.length ? argv[i + 1] : undefined;
    switch (flag) {
      case '--deploy':
      case '-d': {
        args.deploy = next ?? null;
        i++;
        break;
      }
      case '--services':
      case '-s': {
        args.services = next ?? null;
        i++;
        break;
      }
      case '--env':
      case '-e': {
        args.env = next ?? args.env;
        i++;
        break;
      }
      case '--preset':
      case '-p': {
        args.preset = next ?? null;
        i++;
        break;
      }
      case '--port': {
        args.port = parseNumericFlag(next, '--port');
        i++;
        break;
      }
      case '--no-shared-health': {
        args.sharedHealth = false;
        break;
      }
      case '--help':
      case '-h': {
        printHelp();
        process.exit(0);
        break;
      }
      default: {
        // Ignore unknown flags so consumers can wrap the CLI without
        // tripping on harmless extras (e.g. shell sigils).
        break;
      }
    }
  }

  return args;
};

const printHelp = (): void => {
  process.stdout.write(`
luckystack-router — multi-instance load balancer for LuckyStack

USAGE
  luckystack-router --deploy <file> --services <file> [options]

REQUIRED
  --deploy, -d <file>      Path to compiled deploy.config.js (registers DeployConfig).
  --services, -s <file>    Path to compiled services.config.js (registers ServicesConfig).

OPTIONS
  --env, -e <key>          Environment key to run as. Default: NODE_ENV or 'development'.
  --preset, -p <key>       Preset key for the locally-running backend bundle. Optional.
  --port <number>          Listen port. Default: ROUTER_PORT env or routing.defaultRouterPort.
  --no-shared-health       Opt out of the Redis-backed health store (ignored in split/fallback mode).
  --help, -h               Show this help.

EXAMPLES
  luckystack-router --deploy dist/deploy.config.js --services dist/services.config.js --env production
  npx tsx packages/router/dist/cli.js --deploy ./deploy.config.ts --services ./services.config.ts
`);
};

const importConfig = async (file: string, label: string): Promise<void> => {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  try {
    await import(pathToFileURL(abs).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[luckystack-router] failed to import ${label} at ${abs}: ${message}`);
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.deploy || !args.services) {
    process.stderr.write('[luckystack-router] --deploy and --services are required. Run with --help for usage.\n');
    process.exit(2);
  }

  //? Side-effect import order matches what every LuckyStack server entry
  //? does: deploy first, then services. Each one calls its register*()
  //? function on module load.
  await importConfig(args.deploy, 'deploy config');
  await importConfig(args.services, 'services config');

  const running = await startRouter({
    currentEnvKey: args.env,
    localPresetKey: args.preset ?? undefined,
    port: args.port ?? undefined,
    disableSharedHealthState: !args.sharedHealth,
  });

  //? A second signal arriving while `running.stop()` is in flight must not start
  //? a second shutdown — that calls `server.close()` on an already-closing
  //? server (`ERR_SERVER_NOT_RUNNING`), surfacing as an unhandled rejection in
  //? the detached `void shutdown(...)`. Guard so only the first signal acts.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n[luckystack-router] ${signal} received, shutting down...\n`);
    await running.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[luckystack-router] fatal: ${message}\n`);
  process.exit(1);
});
