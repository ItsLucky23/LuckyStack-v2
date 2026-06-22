#!/usr/bin/env node
//? `luckystack-validate-deploy` CLI. Loads the consumer's compiled
//? services.config.js and deploy.config.js as side-effects (they call
//? `registerServicesConfig` / `registerDeployConfig` on import), then runs
//? `validateDeploy()` and prints findings.
//?
//? Designed to be a pre-deploy gate: exit 1 on any error finding, 0
//? otherwise. Warnings print to stderr but never fail the run.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  getDeployConfig,
  getServicesConfig,
  isDeployConfigRegistered,
  isServicesConfigRegistered,
} from '@luckystack/core';

import { validateDeploy, type ValidationFinding } from '../validateDeploy';

interface CliArgs {
  deploy: string | null;
  services: string | null;
  failOnWarning: boolean;
}

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args: CliArgs = {
    deploy: null,
    services: null,
    failOnWarning: false,
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
      case '--strict': {
        args.failOnWarning = true;
        break;
      }
      case '--help':
      case '-h': {
        printHelp();
        process.exit(0);
        break;
      }
      default: {
        break;
      }
    }
  }

  return args;
};

const printHelp = (): void => {
  process.stdout.write(`
luckystack-validate-deploy — pre-deploy validator for services + deploy configs

USAGE
  luckystack-validate-deploy --deploy <file> --services <file> [options]

REQUIRED
  --deploy, -d <file>      Path to compiled deploy.config.js (registers DeployConfig).
  --services, -s <file>    Path to compiled services.config.js (registers ServicesConfig).

OPTIONS
  --strict                 Exit 1 on warnings as well as errors.
  --help, -h               Show this help.

WHAT IT CHECKS
  - Every service is assigned to exactly one preset.
  - Every preset references services that exist.
  - Every environment binding's service matches an actual service.
  - Every environment's redis/mongo resource keys exist.
  - Fallback envs must share the same redis/mongo resource keys.
  - synchronizedEnvKeys and urlEnvKey values resolve at config time (warning only).
  - Services bound in no environment (warning only — valid mid-rollout).

EXAMPLES
  luckystack-validate-deploy --deploy dist/deploy.config.js --services dist/services.config.js
  npx tsx packages/devkit/dist/cli/validateDeploy.js --deploy ./deploy.config.ts --services ./services.config.ts
`);
};

const ALLOWED_CONFIG_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);

const importConfig = async (file: string, label: string): Promise<void> => {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

  //? Guard: resolved path must stay inside cwd (or the resolved project root)
  //? to prevent `--deploy ../../../../etc/shadow` style path injection.
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(
      `[luckystack-validate-deploy] ${label} path "${file}" resolves outside the project root — aborting`,
    );
  }

  //? Guard: only load known JS/TS module extensions.
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_CONFIG_EXTENSIONS.has(ext)) {
    throw new Error(
      `[luckystack-validate-deploy] ${label} path "${file}" has disallowed extension "${ext}" — expected one of ${[...ALLOWED_CONFIG_EXTENSIONS].join(', ')}`,
    );
  }

  try {
    await import(pathToFileURL(abs).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[luckystack-validate-deploy] failed to import ${label} at ${abs}: ${message}`);
  }
};

const COLORS = process.stdout.isTTY
  ? {
      reset: '[0m',
      bold: '[1m',
      dim: '[2m',
      red: '[31m',
      green: '[32m',
      yellow: '[33m',
      cyan: '[36m',
    }
  : { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', cyan: '' };

const printFinding = (finding: ValidationFinding): void => {
  const tag = finding.severity === 'error'
    ? `${COLORS.red}${COLORS.bold}ERROR${COLORS.reset}`
    : `${COLORS.yellow}${COLORS.bold}WARN ${COLORS.reset}`;
  const code = `${COLORS.dim}[${finding.code}]${COLORS.reset}`;
  const location = finding.location ? `\n  ${COLORS.dim}at ${finding.location}${COLORS.reset}` : '';
  const sink = finding.severity === 'error' ? process.stderr : process.stdout;
  sink.write(`${tag} ${code} ${finding.message}${location}\n`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.deploy || !args.services) {
    process.stderr.write('[luckystack-validate-deploy] --deploy and --services are required. Run with --help for usage.\n');
    process.exit(2);
  }

  await importConfig(args.deploy, 'deploy config');
  await importConfig(args.services, 'services config');

  if (!isDeployConfigRegistered()) {
    process.stderr.write('[luckystack-validate-deploy] deploy config file did not call registerDeployConfig — nothing to validate.\n');
    process.exit(2);
  }
  if (!isServicesConfigRegistered()) {
    process.stderr.write('[luckystack-validate-deploy] services config file did not call registerServicesConfig — nothing to validate.\n');
    process.exit(2);
  }

  const result = validateDeploy({
    services: getServicesConfig(),
    deploy: getDeployConfig(),
  });

  for (const finding of result.findings) {
    printFinding(finding);
  }

  const summary = result.ok
    ? `${COLORS.green}${COLORS.bold}OK${COLORS.reset}`
    : `${COLORS.red}${COLORS.bold}FAILED${COLORS.reset}`;
  process.stdout.write(
    `\n${summary} — ${String(result.errorCount)} error(s), ${String(result.warningCount)} warning(s)\n`,
  );

  if (result.errorCount > 0) {
    process.exit(1);
  }
  if (args.failOnWarning && result.warningCount > 0) {
    process.exit(1);
  }
  process.exit(0);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[luckystack-validate-deploy] fatal: ${message}\n`);
  process.exit(1);
});
