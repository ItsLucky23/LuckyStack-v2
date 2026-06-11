//? `luckystack` CLI entry. Today it implements a single command:
//?
//?   npx luckystack add <feature> [--no-install]
//?
//? `add` is the INVERSE of create-luckystack-app's optional-package pruner: it
//? installs an optional `@luckystack/*` package AND injects whatever consumer-
//? `src/` assets a plain `npm i` can't (Vite can't statically import an
//? uninstalled package; file-based routing only scans `src/`). Backend-only
//? features just get the dependency + install — they self-wire at boot.

import { createRequire } from 'node:module';
import { parsePackageVersion, validateProject, type Result } from './lib/project';
import { addPresence, type AddOptions } from './commands/addPresence';
import { addLogin } from './commands/addLogin';
import { addBackendOnly } from './commands/addBackendOnly';
import { checkEnv } from './commands/checkEnv';
import { checkI18n } from './commands/checkI18n';

const cliVersion = parsePackageVersion(createRequire(import.meta.url)('../package.json'));

interface BackendFeature {
  kind: 'backend';
  pkg: string;
  note: string;
}
type FeatureSpec = { kind: 'login' } | { kind: 'presence' } | BackendFeature;

//? The features `add` knows. login + presence inject src/ assets; the rest are
//? backend-only (self-wire via their ./register subpath or the sync bridge).
const FEATURES: Record<string, FeatureSpec> = {
  login: { kind: 'login' },
  presence: { kind: 'presence' },
  email: { kind: 'backend', pkg: '@luckystack/email', note: 'Set RESEND_API_KEY (or SMTP_HOST) to send real mail; otherwise mail logs to the console.' },
  sync: { kind: 'backend', pkg: '@luckystack/sync', note: 'Real-time sync events now work; the client receive bridge attaches automatically.' },
  'error-tracking': { kind: 'backend', pkg: '@luckystack/error-tracking', note: 'Set SENTRY_DSN (or POSTHOG_KEY) to start capturing.' },
  'docs-ui': { kind: 'backend', pkg: '@luckystack/docs-ui', note: 'The API docs page mounts at /_docs in development.' },
};

const HELP = `luckystack — LuckyStack project CLI

Usage:
  npx luckystack add <feature> [--no-install]
  npx luckystack check-env
  npx luckystack check-i18n

add <feature>:
  login           Auth backend + editable /login,/register,/reset-password,/settings pages + LoginForm
  presence        Presence backend + client mounts (LocationProvider, SocketStatusIndicator)
  sync            Real-time sync events (client bridge attaches automatically)
  email           Transactional email (Resend / SMTP / console)
  error-tracking  Sentry / PostHog error tracking
  docs-ui         Dev API docs page at /_docs

check-env         Scan for .env keys unused in code + env vars used but undefined.
check-i18n        Scan for translation keys unused in code + used but missing from locales.
                  Both write structured logs to dump/<KIND>_<hash>.log for an LLM to resolve.

Flags:
  --no-install    (add only) Patch files + package.json but skip running npm install
  -h, --help      Show this help

Run inside a LuckyStack project directory.`;

const main = (): void => {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const [command, feature] = argv;
  const install = !argv.includes('--no-install');

  //? Scan commands — no feature arg, no install; they read the project + write
  //? structured logs to dump/.
  if (command === 'check-env' || command === 'check-i18n') {
    const project = validateProject(process.cwd());
    if (!project) {
      process.exit(1);
    }
    console.log(`luckystack ${command} — scanning ${project.root}`);
    if (command === 'check-env') checkEnv(project);
    else checkI18n(project);
    return;
  }

  if (command !== 'add') {
    console.error(`Unknown command: "${command ?? ''}". Commands: add, check-env, check-i18n.\n`);
    console.log(HELP);
    process.exit(2);
  }

  if (!feature || feature.startsWith('-')) {
    console.error('Missing feature. Usage: npx luckystack add <feature>\n');
    console.log(HELP);
    process.exit(2);
  }

  const spec = FEATURES[feature];
  if (!spec) {
    console.error(`Unknown feature: "${feature}". Known: ${Object.keys(FEATURES).join(', ')}.`);
    process.exit(2);
  }

  const project = validateProject(process.cwd(), 'Run this inside your project directory.');
  if (!project) {
    process.exit(1);
  }

  console.log(`luckystack add ${feature} — patching ${project.root}\n`);
  const options: AddOptions = { install, cliVersion };

  let result: Result<void>;
  switch (spec.kind) {
    case 'login': {
      result = addLogin(project, options);
      break;
    }
    case 'presence': {
      result = addPresence(project, options);
      break;
    }
    case 'backend': {
      result = addBackendOnly(project, spec.pkg, options, spec.note);
      break;
    }
    default: {
      //? Exhaustiveness guard — adding a new FeatureSpec kind without a case here
      //? becomes a compile error rather than a silent no-op.
      const _exhaustive: never = spec;
      throw new Error(`Unhandled feature kind: ${JSON.stringify(_exhaustive)}`);
    }
  }

  if (!result.ok) {
    console.error(`\n✗ ${result.error.message}`);
    process.exit(1);
  }
};

main();
