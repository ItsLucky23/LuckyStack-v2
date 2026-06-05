//? CLI entry. Usage:
//?   npx create-luckystack-app <project-name> [--no-install]
//?
//? Behavior:
//?   1. Resolve target directory from <project-name> (must not exist).
//?   2. Recursively copy `template/` into it, substituting placeholders:
//?      - {{PROJECT_NAME}}   -> the project name (kebab-case).
//?      - {{PROJECT_TITLE}}  -> the project title (Title Case).
//?      - {{LUCKYSTACK_VERSION}} -> the version of the @luckystack/* packages
//?        to depend on. Reads our own version from this package's package.json.
//?   3. Optionally run `npm install` (skip with --no-install).
//?   4. Print next-step instructions.
//?
//? Special filename rule: files in the template named with a leading
//? underscore prefix `_dot_` are renamed to start with `.` — workaround for
//? npm publishing skipping `.gitignore` / `.env*` files.
//?   _dot_gitignore -> .gitignore
//?   _dot_env_template -> .env_template

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

export interface CliArgs {
  projectName: string;
  install: boolean;
  prompt: boolean;
  help: boolean;
}

//? Single source of truth for recognised flag tokens. Used both by the
//? parser (to reject unknown flags) and the help banner (so the list stays
//? in sync with what `parseArgs` actually accepts).
export const VALID_FLAGS = ['--no-install', '--no-prompt', '--help', '-h'] as const;

export const parseArgs = (argv: string[]): CliArgs => {
  let projectName = '';
  let install = true;
  let prompt = true;
  let help = false;
  for (const arg of argv) {
    switch (arg) {
    case '--no-install': {
    install = false;
    break;
    }
    case '--no-prompt': {
    prompt = false;
    break;
    }
    case '--help': 
    case '-h': {
    help = true;
    break;
    }
    default: { if (arg.startsWith('-')) {
      //? Fail-fast on unknown flags. Silently ignoring them previously
      //? meant a typo like `--ni-install` would be swallowed and the
      //? scaffold would proceed with default behavior. Exit 2 matches
      //? the conventional "invalid argument" code.
      console.error(`Unknown flag: ${arg}`);
      console.error(`Valid flags: ${VALID_FLAGS.join(', ')}`);
      console.error('Run with --help for full usage.');
      process.exit(2);
    } else {
      projectName ||= arg;
    }
    }
    }
  }
  return { projectName, install, prompt, help };
};

interface ScaffoldChoices {
  /** Database provider used in `schema.prisma`. */
  dbProvider: 'mongodb' | 'postgresql' | 'mysql' | 'sqlite';
  /** Auth strategy. `'none'` skips auth wiring. */
  authMode: 'none' | 'credentials' | 'credentials+oauth';
  /** OAuth providers wired into `luckystack/login/oauthProviders.ts`. */
  oauthProviders: ('google' | 'github' | 'discord' | 'facebook' | 'microsoft')[];
  /** Transactional email adapter. */
  emailProvider: 'none' | 'console' | 'resend' | 'smtp';
  /** Observability backend. */
  monitoringProvider: 'none' | 'sentry' | 'datadog' | 'posthog';
  /** Enable @luckystack/i18n integration. */
  i18n: boolean;
  /**
   * Copy LuckyStack's AI dev-context into the project (root `CLAUDE.md`, the
   * `docs/luckystack/` deep-dives, `skills/`, `.claude/commands/`, the
   * `branch-logs/` protocol) AND install a pre-commit git hook that keeps the
   * AI snapshot files fresh. Off = a clean project with no AI tooling.
   */
  aiInstructions: boolean;
}

const DEFAULT_CHOICES: ScaffoldChoices = {
  dbProvider: 'mongodb',
  authMode: 'credentials',
  oauthProviders: [],
  emailProvider: 'console',
  monitoringProvider: 'none',
  i18n: true,
  aiInstructions: true,
};

const pickFromList = async <T extends string>(
  rl: readline.Interface,
  label: string,
  options: readonly T[],
  defaultValue: T,
): Promise<T> => {
  const numbered = options.map((opt, idx) => `  ${String(idx + 1)}) ${opt}${opt === defaultValue ? ' (default)' : ''}`).join('\n');
  const raw = await rl.question(`\n${label}\n${numbered}\n> `);
  const answer = raw.trim();
  if (!answer) return defaultValue;
  const asNumber = Number(answer);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
    return options[asNumber - 1] ?? defaultValue;
  }
  const lower = answer.toLowerCase();
  const match = options.find((opt) => opt.toLowerCase() === lower);
  return match ?? defaultValue;
};

const pickMulti = async <T extends string>(
  rl: readline.Interface,
  label: string,
  options: readonly T[],
): Promise<T[]> => {
  const numbered = options.map((opt, idx) => `  ${String(idx + 1)}) ${opt}`).join('\n');
  const raw = await rl.question(`\n${label} (comma-separated, blank = none)\n${numbered}\n> `);
  const answer = raw.trim();
  if (!answer) return [];
  const picks = new Set<T>();
  for (const part of answer.split(',').map((p) => p.trim())) {
    if (!part) continue;
    const asNumber = Number(part);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
      const option = options[asNumber - 1];
      if (option !== undefined) picks.add(option);
      continue;
    }
    const match = options.find((opt) => opt.toLowerCase() === part.toLowerCase());
    if (match) picks.add(match);
  }
  return [...picks];
};

const askYesNo = async (rl: readline.Interface, label: string, defaultValue: boolean): Promise<boolean> => {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const raw = await rl.question(`\n${label} (${hint}) > `);
  const answer = raw.trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
};

//? Non-interactive fallback (pipes / CI / no-TTY): the numbered-prompt flow.
//? Used automatically when stdin/stdout isn't a terminal, so the arrow-key
//? wizard below never breaks an automated run.
const runPromptsFallback = async (): Promise<ScaffoldChoices> => {
  const rl = readline.createInterface({ input, output });
  try {
    const dbProvider = await pickFromList(
      rl,
      'Which database provider do you want to use?',
      ['mongodb', 'postgresql', 'mysql', 'sqlite'] as const,
      'mongodb',
    );
    const authMode = await pickFromList(
      rl,
      'Authentication mode?',
      ['none', 'credentials', 'credentials+oauth'] as const,
      'credentials',
    );
    let oauthProviders: ScaffoldChoices['oauthProviders'] = [];
    if (authMode === 'credentials+oauth') {
      oauthProviders = await pickMulti(
        rl,
        'Which OAuth providers to wire?',
        ['google', 'github', 'discord', 'facebook', 'microsoft'] as const,
      );
    }
    const emailProvider = await pickFromList(
      rl,
      'Transactional email adapter?',
      ['none', 'console', 'resend', 'smtp'] as const,
      'console',
    );
    const monitoringProvider = await pickFromList(
      rl,
      'Observability backend?',
      ['none', 'sentry', 'datadog', 'posthog'] as const,
      'none',
    );
    const i18n = await askYesNo(rl, 'Enable i18n (translations + locale switching)?', true);
    const aiInstructions = await askYesNo(
      rl,
      'Include LuckyStack AI dev instructions (CLAUDE.md, docs, branch-logs, auto-index git hook)?',
      true,
    );
    return { dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, i18n, aiInstructions };
  } finally {
    rl.close();
  }
};

//? ───────── Arrow-key wizard (interactive TTY only) ─────────
//? ↑/↓ move · Enter select · Space toggles in multi-select · ← goes back a step.
//? Zero deps: built on Node's `readline` keypress stream + ANSI escapes.
const ANSI = {
  reset: '[0m', bold: '[1m', dim: '[2m',
  cyan: '[36m', green: '[32m',
} as const;

interface WizardStep {
  key: string;
  type: 'select' | 'multi';
  label: string;
  options: readonly string[];
  defaultValue?: string;
  /** Hide this step when the predicate returns true (e.g. OAuth unless oauth mode). */
  skip?: (answers: Record<string, string | string[]>) => boolean;
}

interface KeyEvent { name?: string; ctrl?: boolean }

//? Resolve an answer back to one of its options without a type assertion — the
//? value always originates from `step.options`, but `find` keeps the union type.
const asOption = <T extends string>(value: string | string[] | undefined, options: readonly T[], fallback: T): T => {
  const single = Array.isArray(value) ? '' : (value ?? '');
  return options.find((option) => option === single) ?? fallback;
};

const runWizard = (steps: readonly WizardStep[]): Promise<Record<string, string | string[]>> =>
  new Promise((resolve) => {
    const answers: Record<string, string | string[]> = {};
    const cursors = steps.map((step) => Math.max(0, step.options.indexOf(step.defaultValue ?? '')));
    const selections = steps.map(() => new Set<string>());
    const visibleSteps = (): number[] => steps.map((_, i) => i).filter((i) => steps[i]?.skip?.(answers) !== true);

    let pointer = 0;
    let prevLines = 0;

    const buildBlock = (): string => {
      const order = visibleSteps();
      const lines: string[] = [''];
      for (const [p, i] of order.entries()) {
        const step = steps[i];
        if (!step) continue;
        if (p < pointer) {
          const answer = answers[step.key];
          const shown = Array.isArray(answer) ? (answer.length > 0 ? answer.join(', ') : 'none') : (answer ?? '');
          lines.push(`${ANSI.green}✔${ANSI.reset} ${step.label} ${ANSI.cyan}${shown}${ANSI.reset}`);
          continue;
        }
        if (p > pointer) continue;
        lines.push(`${ANSI.bold}${step.label}${ANSI.reset}`);
        const cursor = cursors[i] ?? 0;
        for (const [oi, option] of step.options.entries()) {
          const active = oi === cursor;
          const box = step.type === 'multi' ? `${selections[i]?.has(option) === true ? '◉' : '◯'} ` : '';
          const arrow = active ? `${ANSI.cyan}❯${ANSI.reset} ` : '  ';
          const text = active ? `${ANSI.cyan}${box}${option}${ANSI.reset}` : `${box}${option}`;
          lines.push(`${arrow}${text}`);
        }
        const hint = step.type === 'multi'
          ? '↑/↓ move · space toggle · enter confirm'
          : '↑/↓ move · enter select';
        lines.push(`${ANSI.dim}${hint}${pointer > 0 ? ' · ← back' : ''}${ANSI.reset}`);
      }
      return `${lines.join('\n')}\n`;
    };

    const paint = (): void => {
      if (prevLines > 0) output.write(`[${String(prevLines)}A[0J`);
      const block = buildBlock();
      output.write(block);
      prevLines = (block.match(/\n/g) ?? []).length;
    };

    const restoreTerminal = (): void => {
      input.off('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      output.write(`${ANSI.reset}[?25h`);
    };

    function onKey(_str: string, key: KeyEvent): void {
      const order = visibleSteps();
      const i = order[pointer];
      const step = i === undefined ? undefined : steps[i];
      if (i === undefined || !step) return;

      if (key.ctrl === true && key.name === 'c') {
        restoreTerminal();
        output.write('\n');
        process.exit(130);
      }

      if (key.name === 'up') {
        cursors[i] = ((cursors[i] ?? 0) - 1 + step.options.length) % step.options.length;
        paint();
        return;
      }
      if (key.name === 'down') {
        cursors[i] = ((cursors[i] ?? 0) + 1) % step.options.length;
        paint();
        return;
      }
      if (key.name === 'left' && pointer > 0) {
        pointer -= 1;
        paint();
        return;
      }
      if (step.type === 'multi' && key.name === 'space') {
        const option = step.options[cursors[i] ?? 0];
        const set = selections[i];
        if (option !== undefined && set) {
          if (set.has(option)) set.delete(option);
          else set.add(option);
        }
        paint();
        return;
      }
      if (key.name === 'return') {
        answers[step.key] = step.type === 'multi'
          ? step.options.filter((option) => selections[i]?.has(option) === true)
          : asOption(step.options[cursors[i] ?? 0], step.options, step.defaultValue ?? step.options[0] ?? '');
        const nextOrder = visibleSteps();
        pointer += 1;
        paint();
        if (pointer >= nextOrder.length) {
          restoreTerminal();
          resolve(answers);
        }
      }
    }

    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    output.write('[?25l');
    input.on('keypress', onKey);
    paint();
  });

const runPrompts = async (): Promise<ScaffoldChoices> => {
  if (!input.isTTY || !output.isTTY) return runPromptsFallback();

  const answers = await runWizard([
    { key: 'dbProvider', type: 'select', label: 'Which database provider?', options: ['mongodb', 'postgresql', 'mysql', 'sqlite'], defaultValue: 'mongodb' },
    { key: 'authMode', type: 'select', label: 'Authentication mode?', options: ['none', 'credentials', 'credentials+oauth'], defaultValue: 'credentials' },
    { key: 'oauthProviders', type: 'multi', label: 'Which OAuth providers to wire?', options: ['google', 'github', 'discord', 'facebook', 'microsoft'], skip: (a) => a.authMode !== 'credentials+oauth' },
    { key: 'emailProvider', type: 'select', label: 'Transactional email adapter?', options: ['none', 'console', 'resend', 'smtp'], defaultValue: 'console' },
    { key: 'monitoringProvider', type: 'select', label: 'Observability backend?', options: ['none', 'sentry', 'datadog', 'posthog'], defaultValue: 'none' },
    { key: 'i18n', type: 'select', label: 'Enable i18n (translations + locale switching)?', options: ['Yes', 'No'], defaultValue: 'Yes' },
    { key: 'aiInstructions', type: 'select', label: 'Include LuckyStack AI dev instructions (CLAUDE.md, docs, branch-logs, auto-index git hook)?', options: ['Yes', 'No'], defaultValue: 'Yes' },
  ]);

  const authMode = asOption(answers.authMode, ['none', 'credentials', 'credentials+oauth'] as const, 'credentials');
  const oauthAll = ['google', 'github', 'discord', 'facebook', 'microsoft'] as const;
  const rawOauth = answers.oauthProviders;
  const oauthPicked = Array.isArray(rawOauth) ? rawOauth : [];

  return {
    dbProvider: asOption(answers.dbProvider, ['mongodb', 'postgresql', 'mysql', 'sqlite'] as const, 'mongodb'),
    authMode,
    oauthProviders: authMode === 'credentials+oauth' ? oauthAll.filter((provider) => oauthPicked.includes(provider)) : [],
    emailProvider: asOption(answers.emailProvider, ['none', 'console', 'resend', 'smtp'] as const, 'console'),
    monitoringProvider: asOption(answers.monitoringProvider, ['none', 'sentry', 'datadog', 'posthog'] as const, 'none'),
    i18n: answers.i18n === 'Yes',
    aiInstructions: answers.aiInstructions !== 'No',
  };
};

const printHelp = (): void => {
  console.log(`
create-luckystack-app — scaffold a new LuckyStack project

Usage:
  npx create-luckystack-app <project-name> [options]

Options:
  --no-install   Don't run \`npm install\` or \`npx prisma generate\` after copying.
  --no-prompt    Skip the interactive prompts and use defaults (Mongo + credentials).
  --help, -h     Show this message.

Example:
  npx create-luckystack-app my-app
  npx create-luckystack-app my-app --no-prompt --no-install
`);
};

export const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

export const titleCase = (raw: string): string =>
  raw
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || 'My LuckyStack App';

export const readSelfVersion = (): string => {
  //? Fail loudly if the scaffolder can't read its own version — silently
  //? falling back to '0.0.1' would lock every newly-scaffolded project to
  //? a stale dependency set, which is almost always worse than aborting.
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version || !/^\d+\.\d+\.\d+/.test(parsed.version)) {
    throw new Error(
      `create-luckystack-app: cannot determine own version from ${pkgPath}. ` +
      `Got: ${JSON.stringify(parsed.version)}`,
    );
  }
  return parsed.version;
};

//? Filename rule: any occurrence of `_dot_` is rewritten to `.`. Used because
//? npm publish skips files whose names start with `.` (so `.gitignore`,
//? `.env_template`, etc. would be dropped from the tarball if we shipped
//? them under their real names). Examples:
//?   _dot_gitignore               -> .gitignore
//?   _dot_env_template            -> .env_template
//?   _dot_env_dot_local_template  -> .env.local_template
export const renameDotFile = (name: string): string => name.replaceAll('_dot_', '.');

//? Per selected OAuth provider, emit BOTH a `DEV_*` pair (read when NODE_ENV !==
//? production) and an unprefixed pair (read in production) — matching the
//? env-driven registry in `luckystack/login/oauthProviders.ts`. Left uncommented
//? with empty values so the developer only fills them in; the provider stays
//? disabled (no login button, no /auth route) until BOTH its id and secret are
//? set — no code edit required to enable it.
export const buildOAuthEnvVars = (providers: readonly string[]): string => {
  if (providers.length === 0) {
    return [
      '# No OAuth providers were selected at scaffold time. To add one later, just',
      '# set its DEV_<PROVIDER>_CLIENT_ID / _SECRET (dev) and <PROVIDER>_CLIENT_ID /',
      '# _SECRET (prod) below and restart — oauthProviders.ts already wires every',
      '# built-in provider (google, github, discord, facebook, microsoft) by env.',
    ].join('\n');
  }
  return providers
    .map((provider) => {
      const upper = provider.toUpperCase();
      return [
        `# ${provider}`,
        `DEV_${upper}_CLIENT_ID=`,
        `DEV_${upper}_CLIENT_SECRET=`,
        `${upper}_CLIENT_ID=`,
        `${upper}_CLIENT_SECRET=`,
      ].join('\n');
    })
    .join('\n\n');
};

export const replacePlaceholders = (
  content: string,
  vars: Record<string, string>,
): string => {
  return content.replaceAll(/{{(\w+)}}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? match) : match;
  });
};

export const isTextFile = (filePath: string): boolean => {
  const textExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.prisma'];
  if (textExts.includes(path.extname(filePath))) return true;
  // Files without extensions but starting with a dot (e.g. .env_template) are text.
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  return false;
};

const copyTree = (src: string, dest: string, vars: Record<string, string>): void => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, renameDotFile(entry.name));

    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, vars);
      continue;
    }

    if (isTextFile(destPath)) {
      const content = fs.readFileSync(srcPath, 'utf8');
      fs.writeFileSync(destPath, replacePlaceholders(content, vars), 'utf8');
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const runNpmInstall = (cwd: string): void => {
  console.log('\nInstalling dependencies (this may take a minute)...\n');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['install'], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] npm install failed. You can run it manually in the project directory.');
  }
};

//? After dependencies install, generate the Prisma client so types resolve
//? on first build. We deliberately do NOT run `prisma db push` / `migrate`
//? — that needs a live DATABASE_URL the user hasn't populated yet, and
//? failing here would be the first thing they see.
const runPrismaGenerate = (cwd: string): void => {
  console.log('\nGenerating Prisma client...\n');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, ['prisma', 'generate'], { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] `npx prisma generate` failed. Run it manually after setting DATABASE_URL.');
  }
};

//? Pre-commit hook that regenerates the consumer's AI snapshot files
//? (docs/AI_CAPABILITIES.md + docs/AI_PROJECT_INDEX.md) and stages them, so they
//? never drift from the code. Mirrors the framework repo's own hook. Wired via a
//? `prepare` script setting `core.hooksPath` at install time (no-op when the
//? project isn't a git repo yet — the hook activates after `git init`).
const AI_INDEX_HOOK = `#!/bin/sh
#? Auto-installed by create-luckystack-app. Regenerates LuckyStack's AI snapshot
#? files so they stay in sync with this commit, then stages them. The generators
#? are deterministic (no timestamps), so a no-op commit leaves them unchanged.
set -e
if ! command -v npm >/dev/null 2>&1; then
  echo "[pre-commit] npm not on PATH — skipping AI snapshot regeneration."
  exit 0
fi
echo "[pre-commit] Regenerating docs/AI_CAPABILITIES.md..."
npm run ai:capabilities --silent
echo "[pre-commit] Regenerating docs/AI_PROJECT_INDEX.md..."
npm run ai:project-index --silent
git add docs/AI_CAPABILITIES.md docs/AI_PROJECT_INDEX.md
`;

const installAiIndexHook = (targetDir: string): void => {
  const hooksDir = path.join(targetDir, '.githooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, AI_INDEX_HOOK);
  //? rwxr-xr-x so git can execute it on POSIX. No-op semantics on Windows.
  fs.chmodSync(hookPath, 0o755);

  //? Add a `prepare` script that points git at .githooks on install. Wrapped so
  //? it never fails the install when the directory isn't a git repo yet.
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string | undefined> };
  pkg.scripts ??= {};
  pkg.scripts.prepare ??= "node -e \"try{require('child_process').execSync('git config core.hooksPath .githooks',{stdio:'ignore'})}catch{}\"";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.projectName) {
    console.error('Missing project name.\n');
    printHelp();
    process.exit(1);
  }

  const slug = slugify(args.projectName);
  if (!slug) {
    console.error(`Invalid project name: "${args.projectName}". Use letters, numbers, and dashes.`);
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), args.projectName);
  if (fs.existsSync(targetDir)) {
    console.error(`Target directory already exists: ${targetDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`Template directory missing: ${TEMPLATE_DIR}`);
    console.error('This is a packaging bug — the template/ folder should ship with the package.');
    process.exit(1);
  }

  //? Interactive prompts gather scaffold choices. `--no-prompt` skips
  //? them and uses sane defaults (Mongo + credentials + console email).
  const choices: ScaffoldChoices = args.prompt ? await runPrompts() : DEFAULT_CHOICES;

  //? Provider-specific Prisma + DATABASE_URL bits. MongoDB needs an ObjectId
  //? `_id` mapping; the SQL providers use a cuid string id. The example URL is
  //? pre-filled for the chosen provider (the others stay as commented hints).
  const USER_ID_ATTRS_BY_PROVIDER: Record<string, string> = {
    mongodb: '@id @default(auto()) @map("_id") @db.ObjectId',
    postgresql: '@id @default(cuid())',
    mysql: '@id @default(cuid())',
    sqlite: '@id @default(cuid())',
  };
  const DATABASE_URL_BY_PROVIDER: Record<string, string> = {
    //? Prisma + MongoDB REQUIRES a replica set (it uses transactions); a bare
    //? `mongodb://host/db` URL fails at runtime. `replicaSet=rs0` +
    //? `directConnection=true` is the canonical single-node dev replica-set shape.
    mongodb: `mongodb://localhost:27017/${slug}?replicaSet=rs0&directConnection=true`,
    postgresql: `postgresql://user:password@localhost:5432/${slug}`,
    mysql: `mysql://user:password@localhost:3306/${slug}`,
    sqlite: 'file:./dev.db',
  };

  //? OAuth provider -> the browser origin its login redirect/callback arrives
  //? from. The callback hits your app with the provider's origin as `Referer`,
  //? so each enabled provider's origin must be in the CORS allow-list
  //? (EXTERNAL_ORIGINS) or the framework's origin gate rejects the callback.
  const OAUTH_PROVIDER_ORIGINS: Record<string, string> = {
    google: 'https://accounts.google.com',
    github: 'https://github.com',
    facebook: 'https://www.facebook.com',
    discord: 'https://discord.com',
    microsoft: 'https://login.microsoftonline.com',
  };
  const externalOrigins = choices.oauthProviders
    .map((provider) => OAUTH_PROVIDER_ORIGINS[provider])
    .filter(Boolean)
    .join(',');

  const vars: Record<string, string> = {
    PROJECT_NAME: slug,
    PROJECT_TITLE: titleCase(args.projectName),
    LUCKYSTACK_VERSION: readSelfVersion(),
    DB_PROVIDER: choices.dbProvider,
    USER_ID_ATTRS: USER_ID_ATTRS_BY_PROVIDER[choices.dbProvider] ?? '@id @default(cuid())',
    DATABASE_URL: DATABASE_URL_BY_PROVIDER[choices.dbProvider] ?? `postgresql://user:password@localhost:5432/${slug}`,
    AUTH_MODE: choices.authMode,
    OAUTH_PROVIDERS: choices.oauthProviders.join(','),
    OAUTH_ENV_VARS: buildOAuthEnvVars(choices.oauthProviders),
    EXTERNAL_ORIGINS: externalOrigins,
    EMAIL_PROVIDER: choices.emailProvider,
    MONITORING_PROVIDER: choices.monitoringProvider,
    I18N_ENABLED: choices.i18n ? 'true' : 'false',
  };

  console.log(`\nScaffolding ${slug} into ${targetDir}\n`);
  copyTree(TEMPLATE_DIR, targetDir, vars);

  //? AI dev-context is opt-in (the `aiInstructions` choice). When enabled we copy
  //? the framework's AI docs so the consumer's AI agents inherit full context,
  //? and install a pre-commit hook that keeps the AI snapshot files fresh. When
  //? disabled the project ships clean — no CLAUDE.md, no docs/luckystack, no hook.
  if (choices.aiInstructions) {
    //? Only branch-logs/README.md is copied (not the framework's own log
    //? entries) — the consumer's first session initializes their own log file.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const docsCopies: [string, string, boolean][] = [
      // [source, dest, isDirectory]
      [path.join(repoRoot, 'CLAUDE.md'),                path.join(targetDir, 'CLAUDE.md'),                  false],
      [path.join(repoRoot, 'docs'),                     path.join(targetDir, 'docs', 'luckystack'),         true],
      [path.join(repoRoot, 'skills'),                   path.join(targetDir, 'skills'),                     true],
      [path.join(repoRoot, '.claude', 'commands'),      path.join(targetDir, '.claude', 'commands'),        true],
      [path.join(repoRoot, 'branch-logs', 'README.md'), path.join(targetDir, 'branch-logs', 'README.md'),   false],
    ];
    let copiedCount = 0;
    for (const [src, dst, isDir] of docsCopies) {
      if (!fs.existsSync(src)) continue;
      if (isDir) {
        copyTree(src, dst, vars);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        //? Route text-file copies through `replacePlaceholders` so framework-doc
        //? files that adopt `{{PROJECT_NAME}}`-style tokens later get rendered
        //? consistently with the template tree. Binary files fall back to a raw
        //? byte copy.
        if (isTextFile(src)) {
          const rendered = replacePlaceholders(fs.readFileSync(src, 'utf8'), vars);
          fs.writeFileSync(dst, rendered);
        } else {
          fs.copyFileSync(src, dst);
        }
      }
      copiedCount++;
    }

    installAiIndexHook(targetDir);

    if (copiedCount > 0) {
      console.log(`Framework AI documentation copied (${copiedCount} source(s) merged into target) + pre-commit AI-index hook installed.`);
    }
  }

  console.log('Files written.');

  if (args.install) {
    runNpmInstall(targetDir);
    runPrismaGenerate(targetDir);
  } else {
    console.log('\nSkipped npm install (--no-install).');
  }

  console.log(`
Done — scaffold complete.

Choices:
  database:    ${choices.dbProvider}
  auth:        ${choices.authMode}${choices.oauthProviders.length > 0 ? ' (' + choices.oauthProviders.join(', ') + ')' : ''}
  email:       ${choices.emailProvider}
  monitoring:  ${choices.monitoringProvider}
  i18n:        ${choices.i18n ? 'on' : 'off'}
  ai-docs:     ${choices.aiInstructions ? 'included (+ pre-commit AI-index hook)' : 'skipped'}

Next steps:
  cd ${args.projectName}
  cp .env_template .env
  cp .env.local_template .env.local   # fill in DATABASE_URL, etc.
  ${choices.dbProvider === 'mongodb'
    ? 'npm run prisma:db:push           # initializes the Mongo schema'
    : 'npm run prisma:migrate:dev       # creates the User table + initial migration'}
  npm run server                       # starts the dev server

Docs:
  https://github.com/ItsLucky23/LuckyStack-v2#readme
`);
};

//? Only run the scaffold when this file is the process entry point (i.e. the
//? installed `create-luckystack-app` bin). Importing it as a module — e.g. the
//? unit tests that exercise the pure helpers — must NOT trigger the
//? filesystem copy / `npm install` / prompts side-effects of `main()`.
const isCliEntry = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(__filename);
  } catch {
    return false;
  }
};

if (isCliEntry()) {
  main().catch((error: unknown) => {
    console.error('\n[create-luckystack-app] unexpected error:', error);
    process.exit(1);
  });
}
