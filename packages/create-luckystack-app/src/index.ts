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
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

interface CliArgs {
  projectName: string;
  install: boolean;
  prompt: boolean;
  help: boolean;
}

//? Single source of truth for recognised flag tokens. Used both by the
//? parser (to reject unknown flags) and the help banner (so the list stays
//? in sync with what `parseArgs` actually accepts).
const VALID_FLAGS = ['--no-install', '--no-prompt', '--help', '-h'] as const;

const parseArgs = (argv: string[]): CliArgs => {
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
}

const DEFAULT_CHOICES: ScaffoldChoices = {
  dbProvider: 'mongodb',
  authMode: 'credentials',
  oauthProviders: [],
  emailProvider: 'console',
  monitoringProvider: 'none',
  i18n: true,
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

const runPrompts = async (): Promise<ScaffoldChoices> => {
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
    return { dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, i18n };
  } finally {
    rl.close();
  }
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

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

const titleCase = (raw: string): string =>
  raw
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || 'My LuckyStack App';

const readSelfVersion = (): string => {
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
const renameDotFile = (name: string): string => name.replaceAll('_dot_', '.');

const replacePlaceholders = (
  content: string,
  vars: Record<string, string>,
): string => {
  return content.replaceAll(/{{(\w+)}}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? match) : match;
  });
};

const isTextFile = (filePath: string): boolean => {
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

  const vars: Record<string, string> = {
    PROJECT_NAME: slug,
    PROJECT_TITLE: titleCase(args.projectName),
    LUCKYSTACK_VERSION: readSelfVersion(),
    DB_PROVIDER: choices.dbProvider,
    AUTH_MODE: choices.authMode,
    OAUTH_PROVIDERS: choices.oauthProviders.join(','),
    EMAIL_PROVIDER: choices.emailProvider,
    MONITORING_PROVIDER: choices.monitoringProvider,
    I18N_ENABLED: choices.i18n ? 'true' : 'false',
  };

  console.log(`\nScaffolding ${slug} into ${targetDir}\n`);
  copyTree(TEMPLATE_DIR, targetDir, vars);

  //? Copy framework AI documentation so consumer's AI agents have full context.
  //? Only branch-logs/README.md is copied (not the framework's own log entries) —
  //? the consumer's first session initializes their own branch-log file.
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
  if (copiedCount > 0) {
    console.log(`Framework AI documentation copied (${copiedCount} source(s) merged into target).`);
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

main().catch((error: unknown) => {
  console.error('\n[create-luckystack-app] unexpected error:', error);
  process.exit(1);
});
