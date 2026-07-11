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
import { writeScaffoldManifest } from './scaffoldManifest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

export interface CliArgs {
  projectName: string;
  install: boolean;
  prompt: boolean;
  help: boolean;
  /** `--presence`: opt INTO @luckystack/presence (off by default). */
  presence: boolean;
  /** `--error-tracking`: opt INTO @luckystack/error-tracking (off by default). */
  errorTracking: boolean;
  /** `--docs-ui`: opt INTO @luckystack/docs-ui (off by default). */
  docsUi: boolean;
  /** `--secret-manager`: opt INTO @luckystack/secret-manager (off by default). */
  secretManager: boolean;
  /** `--router`: opt INTO @luckystack/router (multi-instance; off by default). */
  router: boolean;
  /** `--ai-browser=<all|agent-browser|none>`: AI browser-testing tooling (null = unspecified → DEFAULT_CHOICES). */
  aiBrowserTooling: AiBrowserTooling | null;
  //? CFG-01 — every wizard choice now has a matching CLI flag so the scaffold is
  //? fully scriptable (CI / AI / `--no-prompt`). `null` = flag not passed → the
  //? wizard asks (interactive) or the default applies (`--no-prompt`).
  orm: OrmProvider | null;
  dbProvider: DbProvider | null;
  authMode: AuthMode | null;
  /** From `--oauth=google,github,...`. `null` = not passed. Only used when authMode resolves to `credentials+oauth`. */
  oauthProviders: OAuthProvider[] | null;
  emailProvider: EmailProvider | null;
  monitoringProvider: MonitoringProvider | null;
  /** `--no-ai-docs` (off) / `--ai-docs` (on). `null` = not passed. */
  aiInstructions: boolean | null;
}

//? Single source of truth for recognised flag tokens. Used both by the
//? parser (to reject unknown flags) and the help banner (so the list stays
//? in sync with what `parseArgs` actually accepts). The `--key=value` flags
//? are parsed in the default arm; they're listed here for the help/error banner.
export const VALID_FLAGS = [
  '--no-install', '--no-prompt',
  '--orm=<prisma|drizzle|mikro-orm|none>',
  '--db=<mongodb|postgresql|mysql|sqlite>',
  '--auth=<none|credentials|credentials+oauth>',
  '--oauth=<google,github,discord,facebook,microsoft>',
  '--email=<none|console|resend|smtp>',
  '--monitoring=<none|sentry|datadog|posthog>',
  '--presence', '--error-tracking', '--docs-ui', '--secret-manager', '--router',
  '--ai-docs', '--no-ai-docs',
  '--ai-browser=<all|agent-browser|none>',
  '--help', '-h',
] as const;

//? Validate a `--key=value` flag's value against its canonical option list,
//? exiting 2 (the conventional invalid-argument code) on a bad value — same
//? convention as `--ai-browser`. Returns the validated value typed to the list.
const parseValueFlag = <T extends string>(flag: string, value: string, options: readonly T[]): T => {
  if ((options as readonly string[]).includes(value)) return value as T;
  console.error(`Invalid ${flag} value: ${value}`);
  console.error(`Valid values: ${options.join(', ')}`);
  process.exit(2);
};

export const parseArgs = (argv: string[]): CliArgs => {
  let projectName = '';
  let install = true;
  let prompt = true;
  let help = false;
  let presence = false;
  let errorTracking = false;
  let docsUi = false;
  let secretManager = false;
  let router = false;
  let aiBrowserTooling: AiBrowserTooling | null = null;
  let orm: OrmProvider | null = null;
  let dbProvider: DbProvider | null = null;
  let authMode: AuthMode | null = null;
  let oauthProviders: OAuthProvider[] | null = null;
  let emailProvider: EmailProvider | null = null;
  let monitoringProvider: MonitoringProvider | null = null;
  let aiInstructions: boolean | null = null;
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
    case '--presence': {
    presence = true;
    break;
    }
    case '--error-tracking': {
    errorTracking = true;
    break;
    }
    case '--docs-ui': {
    docsUi = true;
    break;
    }
    case '--secret-manager': {
    secretManager = true;
    break;
    }
    case '--router': {
    router = true;
    break;
    }
    case '--ai-docs': {
    aiInstructions = true;
    break;
    }
    case '--no-ai-docs': {
    aiInstructions = false;
    break;
    }
    case '--help':
    case '-h': {
    help = true;
    break;
    }
    default: { if (arg.startsWith('--ai-browser=')) {
      aiBrowserTooling = parseValueFlag('--ai-browser', arg.slice('--ai-browser='.length), PROVIDER_OPTIONS.aiBrowserTooling);
    } else if (arg.startsWith('--orm=')) {
      orm = parseValueFlag('--orm', arg.slice('--orm='.length), PROVIDER_OPTIONS.orm);
    } else if (arg.startsWith('--db=')) {
      dbProvider = parseValueFlag('--db', arg.slice('--db='.length), PROVIDER_OPTIONS.dbProvider);
    } else if (arg.startsWith('--auth=')) {
      authMode = parseValueFlag('--auth', arg.slice('--auth='.length), PROVIDER_OPTIONS.authMode);
    } else if (arg.startsWith('--email=')) {
      emailProvider = parseValueFlag('--email', arg.slice('--email='.length), PROVIDER_OPTIONS.emailProvider);
    } else if (arg.startsWith('--monitoring=')) {
      monitoringProvider = parseValueFlag('--monitoring', arg.slice('--monitoring='.length), PROVIDER_OPTIONS.monitoringProvider);
    } else if (arg.startsWith('--oauth=')) {
      //? Comma-separated list; each entry validated against the provider list
      //? (exit 2 on any bad entry). Empty (`--oauth=`) yields an empty list.
      const raw = arg.slice('--oauth='.length).split(',').map((p) => p.trim()).filter(Boolean);
      oauthProviders = raw.map((entry) => parseValueFlag('--oauth', entry, PROVIDER_OPTIONS.oauthProviders));
    } else if (arg.startsWith('-')) {
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
  return {
    projectName, install, prompt, help, presence, errorTracking, docsUi, secretManager, router, aiBrowserTooling,
    orm, dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, aiInstructions,
  };
};

//? Single source of truth for the selectable provider lists. The wizard, the
//? non-interactive fallback prompts, the answer→choice conversion, and the
//? env-var builders all read from here so a new provider is added in exactly
//? one place. Declared `as const` so each list stays a readonly literal-union
//? tuple (drives the `ScaffoldChoices` field types below).
const PROVIDER_OPTIONS = {
  //? ORM dimension (ADR 0020): 'prisma' = the classic full setup (all 4 DBs);
  //? 'drizzle' = TypeScript-first SQL ORM (postgresql/mysql/sqlite — NO
  //? MongoDB, the db step filters it); 'mikro-orm' = TypeScript-first with
  //? first-class MongoDB (all 4 DBs); 'none' = bring-your-own data layer via
  //? the `functions/db.ts` + `luckystack/core/clients.ts` hooks. Non-prisma
  //? choices force auth off — the built-in UserAdapter is Prisma-backed.
  orm: ['prisma', 'drizzle', 'mikro-orm', 'none'],
  dbProvider: ['mongodb', 'postgresql', 'mysql', 'sqlite'],
  authMode: ['none', 'credentials', 'credentials+oauth'],
  oauthProviders: ['google', 'github', 'discord', 'facebook', 'microsoft'],
  emailProvider: ['none', 'console', 'resend', 'smtp'],
  monitoringProvider: ['none', 'sentry', 'datadog', 'posthog'],
  aiBrowserTooling: ['all', 'agent-browser', 'none'],
} as const;

type OrmProvider = (typeof PROVIDER_OPTIONS.orm)[number];
type DbProvider = (typeof PROVIDER_OPTIONS.dbProvider)[number];

//? Drizzle is SQL-only — MongoDB (the scaffold default!) is not an option
//? under it. The wizard swaps in this filtered list for the db step; the
//? flag/no-prompt paths validate against it and exit(2) on an explicit
//? invalid combo.
const SQL_DB_PROVIDERS = PROVIDER_OPTIONS.dbProvider.filter(
  (provider): provider is Exclude<DbProvider, 'mongodb'> => provider !== 'mongodb',
);
const ormSupportsDb = (orm: OrmProvider, dbProvider: DbProvider): boolean =>
  orm !== 'drizzle' || dbProvider !== 'mongodb';
type AuthMode = (typeof PROVIDER_OPTIONS.authMode)[number];
type OAuthProvider = (typeof PROVIDER_OPTIONS.oauthProviders)[number];
type EmailProvider = (typeof PROVIDER_OPTIONS.emailProvider)[number];
type MonitoringProvider = (typeof PROVIDER_OPTIONS.monitoringProvider)[number];
type AiBrowserTooling = (typeof PROVIDER_OPTIONS.aiBrowserTooling)[number];

interface ScaffoldChoices {
  /**
   * Data-layer choice (ADR 0020). `'prisma'` ships the full Prisma setup;
   * `'drizzle'` (SQL-only) and `'mikro-orm'` (incl. MongoDB) ship
   * TypeScript-first starters under `server/db/` + a live `functions/db.ts`
   * client; `'none'` leaves the bring-your-own hooks. Every non-prisma value
   * forces `authMode: 'none'` — the default UserAdapter is Prisma-backed.
   */
  orm: OrmProvider;
  /** Database provider used in `schema.prisma`. Ignored when `orm: 'none'`. */
  dbProvider: DbProvider;
  /** Auth strategy. `'none'` skips auth wiring. */
  authMode: AuthMode;
  /** OAuth providers wired into `luckystack/login/oauthProviders.ts`. */
  oauthProviders: OAuthProvider[];
  /** Transactional email adapter. */
  emailProvider: EmailProvider;
  /** Observability backend. */
  monitoringProvider: MonitoringProvider;
  /** Install @luckystack/presence (AFK/presence/socket-status). Optional peer. */
  presence: boolean;
  /** Install @luckystack/error-tracking (Sentry capture + auto-instrumentation). Opt-in; off by default. */
  errorTracking: boolean;
  /** Install @luckystack/docs-ui (in-app API docs viewer). Opt-in; off by default. */
  docsUi: boolean;
  /** Install @luckystack/secret-manager (`.env`-pointer secret resolution). Opt-in; off by default. */
  secretManager: boolean;
  /** Install @luckystack/router (multi-instance load-balancer process) + a `npm run router` script. Opt-in; off by default. */
  router: boolean;
  /**
   * Copy LuckyStack's AI dev-context into the project (root `CLAUDE.md`, the
   * `docs/luckystack/` deep-dives, `skills/`, `.claude/commands/`, the
   * `branch-logs/` protocol) AND install a pre-commit git hook that keeps the
   * AI snapshot files fresh. Off = a clean project with no AI tooling.
   */
  aiInstructions: boolean;
  /**
   * AI browser-testing tooling (agent-browser CLI + optional Playwright /
   * Chrome DevTools MCP servers, all user-approval-gated). `'agent-browser'`
   * = the cheap CLI default; `'all'` = also wire both MCP servers; `'none'`
   * = skip. Only wired when `aiInstructions` is on (it's an AI-template
   * sub-feature). Dev-tools only — never runtime dependencies.
   */
  aiBrowserTooling: AiBrowserTooling;
}

//? Lean-by-default: every optional package/feature starts OFF so a fresh scaffold
//? is the minimal runtime (core/server/api/sync + a database). Each is opt-in via
//? the wizard or a CLI flag. The ONE exception is `aiInstructions` — it ships only
//? docs + a git hook (no app-runtime weight) and is the framework's core dev value,
//? so it stays on by default.
const DEFAULT_CHOICES: ScaffoldChoices = {
  orm: 'prisma',
  dbProvider: 'mongodb',
  authMode: 'none',
  oauthProviders: [],
  emailProvider: 'none',
  monitoringProvider: 'none',
  presence: false,
  errorTracking: false,
  docsUi: false,
  secretManager: false,
  router: false,
  aiInstructions: true,
  aiBrowserTooling: 'agent-browser',
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
  if (!match) {
    //? Unrecognised input (e.g. piped script sent an unexpected string). Warn
    //? so non-interactive callers notice the fallback rather than silently
    //? accepting the wrong choice.
    console.warn(`[create-luckystack-app] Unrecognised input "${answer}" for "${label}" — using default "${defaultValue}".`);
  }
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
const runPromptsFallback = async (
  presets: Record<string, string | string[]> = {},
): Promise<ScaffoldChoices> => {
  const rl = readline.createInterface({ input, output });
  //? Gather into the same answer-bag the wizard produces, then funnel through
  //? `convertAnswersToChoices` so the two prompt paths share one validation +
  //? normalization seam. CLI-flag presets (CFG-01) pre-fill the bag; we only
  //? prompt for keys that weren't supplied on the command line.
  const answers: Record<string, string | string[]> = { ...presets };
  const need = (key: string): boolean => !(key in presets);
  try {
    if (need('orm')) {
      answers.orm = await pickFromList(rl, 'Which ORM / data layer? (prisma = classic · drizzle = TS-first SQL · mikro-orm = TS-first incl. MongoDB · none = bring your own)', PROVIDER_OPTIONS.orm, 'prisma');
    }
    const orm = asOption(answers.orm, PROVIDER_OPTIONS.orm, 'prisma');
    if (orm !== 'none' && need('dbProvider')) {
      //? Drizzle is SQL-only — offer the filtered list (and a matching default).
      answers.dbProvider = orm === 'drizzle'
        ? await pickFromList(rl, 'Which database provider? (drizzle is SQL-only)', SQL_DB_PROVIDERS, 'postgresql')
        : await pickFromList(rl, 'Which database provider do you want to use?', PROVIDER_OPTIONS.dbProvider, 'mongodb');
    }
    if (orm === 'prisma' && need('authMode')) {
      answers.authMode = await pickFromList(rl, 'Authentication mode?', PROVIDER_OPTIONS.authMode, 'none');
    }
    const authMode = orm === 'prisma' ? asOption(answers.authMode, PROVIDER_OPTIONS.authMode, 'none') : 'none';
    if (authMode === 'credentials+oauth' && need('oauthProviders')) {
      answers.oauthProviders = await pickMulti(rl, 'Which OAuth providers to wire?', PROVIDER_OPTIONS.oauthProviders);
    }
    if (need('emailProvider')) {
      answers.emailProvider = await pickFromList(rl, 'Transactional email adapter?', PROVIDER_OPTIONS.emailProvider, 'none');
    }
    if (need('monitoringProvider')) {
      answers.monitoringProvider = await pickFromList(rl, 'Observability backend?', PROVIDER_OPTIONS.monitoringProvider, 'none');
    }
    if (need('presence')) {
      answers.presence = (await askYesNo(rl, 'Install @luckystack/presence (AFK / presence / socket-status)?', false)) ? 'Yes' : 'No';
    }
    if (need('errorTracking')) {
      answers.errorTracking = (await askYesNo(rl, 'Install @luckystack/error-tracking (error capture + auto-instrumentation)?', false)) ? 'Yes' : 'No';
    }
    if (need('docsUi')) {
      answers.docsUi = (await askYesNo(rl, 'Install @luckystack/docs-ui (in-app API docs viewer)?', false)) ? 'Yes' : 'No';
    }
    if (need('secretManager')) {
      answers.secretManager = (await askYesNo(rl, 'Install @luckystack/secret-manager (.env-pointer secret resolution)?', false)) ? 'Yes' : 'No';
    }
    if (need('router')) {
      answers.router = (await askYesNo(rl, 'Install @luckystack/router (multi-instance load-balancer; run via npm run router)?', false)) ? 'Yes' : 'No';
    }
    if (need('aiInstructions')) {
      answers.aiInstructions = (await askYesNo(
        rl,
        'Include LuckyStack AI dev instructions (CLAUDE.md, docs, branch-logs, auto-index git hook)?',
        true,
      )) ? 'Yes' : 'No';
    }
    //? Browser tooling is an AI-template sub-feature — only offered when the AI
    //? instructions are included. `convertAnswersToChoices` forces 'none' when
    //? aiInstructions is off, so a stale preset can't leak through.
    const aiInstructions = answers.aiInstructions !== 'No';
    if (aiInstructions && need('aiBrowserTooling')) {
      answers.aiBrowserTooling = await pickFromList(
        rl,
        'Set up AI browser-testing tooling? (all = agent-browser + Playwright/Chrome DevTools MCP; agent-browser = cheap CLI only; none)',
        PROVIDER_OPTIONS.aiBrowserTooling,
        'agent-browser',
      );
    }
    return convertAnswersToChoices(answers);
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

//? Wrap `text` in one or more ANSI style codes and terminate with a reset, so
//? call sites read as `ansiStyle('Next', ANSI.cyan, ANSI.bold)` instead of
//? hand-concatenating escape strings around every span.
const ansiStyle = (text: string, ...styles: string[]): string =>
  `${styles.join('')}${text}${ANSI.reset}`;

interface WizardStep {
  key: string;
  type: 'select' | 'multi';
  label: string;
  /** One-line plain-language explanation shown dimmed under the label (e.g. which @luckystack package this installs + what it does). */
  description?: string;
  /** Optional longer, multi-line explanation revealed when the user presses `?` on this step (for packages whose purpose isn't obvious from one line). */
  details?: string;
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

const runWizard = (
  steps: readonly WizardStep[],
  presets: Record<string, string | string[]> = {},
): Promise<Record<string, string | string[]>> =>
  new Promise((resolve) => {
    //? Steps whose answer arrived via a CLI flag (CFG-01) are pre-filled and
    //? hidden — the wizard only asks for what wasn't specified on the command
    //? line. Skip predicates still read `answers`, so a preset `authMode`
    //? correctly drives whether the OAuth step shows.
    const answers: Record<string, string | string[]> = { ...presets };
    const cursors = steps.map((step) => Math.max(0, step.options.indexOf(step.defaultValue ?? '')));
    const selections = steps.map(() => new Set<string>());
    const visibleSteps = (): number[] =>
      steps.map((_, i) => i).filter((i) => {
        const step = steps[i];
        if (!step) return false;
        if (step.key in presets) return false;
        return step.skip?.(answers) !== true;
      });

    let pointer = 0;
    let prevLines = 0;
    //? Whether the current step's expandable `details` block is open (toggled with
    //? `?`). Reset on every step change so each step starts collapsed.
    let detailsOpen = false;
    //? After the last step the wizard enters a REVIEW screen (all choices listed)
    //? instead of resolving immediately — so the final answer is reviewable and
    //? editable (← jumps back into the steps) before the project is created.
    let reviewing = false;

    //? Render a value for the review/confirmed-step lines (joins multi-selects,
    //? shows 'none' for an empty multi-select).
    const shownAnswer = (key: string): string => {
      const answer = answers[key];
      return Array.isArray(answer) ? (answer.length > 0 ? answer.join(', ') : 'none') : (answer ?? '');
    };

    const buildBlock = (): string => {
      const order = visibleSteps();
      //? Final review screen: every choice listed, editable via ← before commit.
      if (reviewing) {
        const lines = ['', ansiStyle('Review your choices', ANSI.bold)];
        for (const i of order) {
          const step = steps[i];
          if (step) lines.push(`${ansiStyle('✔', ANSI.green)} ${step.label} ${ansiStyle(shownAnswer(step.key), ANSI.cyan)}`);
        }
        lines.push(
          '',
          ansiStyle('enter create project', ANSI.cyan, ANSI.bold),
          ansiStyle('← back to edit', ANSI.dim),
        );
        return `${lines.join('\n')}\n`;
      }
      const lines: string[] = [''];
      for (const [p, i] of order.entries()) {
        const step = steps[i];
        if (!step) continue;
        if (p < pointer) {
          lines.push(`${ansiStyle('✔', ANSI.green)} ${step.label} ${ansiStyle(shownAnswer(step.key), ANSI.cyan)}`);
          continue;
        }
        if (p > pointer) continue;
        //? `(current/total)` progress counter — total is the count of currently
        //? VISIBLE steps, so it reflects conditional steps appearing/disappearing.
        lines.push(`${ansiStyle(step.label, ANSI.bold)} ${ansiStyle(`(${String(p + 1)}/${String(order.length)})`, ANSI.dim)}`);
        if (step.description !== undefined && step.description !== '') {
          lines.push(ansiStyle(step.description, ANSI.dim));
        }
        //? Expandable detail block (toggled with `?`) — for packages whose purpose
        //? needs more than the one-line description.
        if (detailsOpen && step.details !== undefined && step.details !== '') {
          for (const detailLine of step.details.split('\n')) {
            lines.push(ansiStyle(`  ${detailLine}`, ANSI.dim));
          }
        }
        const cursor = cursors[i] ?? 0;
        for (const [oi, option] of step.options.entries()) {
          const active = oi === cursor;
          const box = step.type === 'multi' ? `${selections[i]?.has(option) === true ? '◉' : '◯'} ` : '';
          const arrow = active ? `${ansiStyle('❯', ANSI.cyan)} ` : '  ';
          const text = active ? ansiStyle(`${box}${option}`, ANSI.cyan) : `${box}${option}`;
          lines.push(`${arrow}${text}`);
        }
        //? Multi-select gets a trailing, non-toggleable "Next" action row (cursor
        //? index === options.length). Space/Enter there confirms the whole step,
        //? so Space/Enter on a provider can mean "toggle" without also confirming.
        //? Two leading spaces align the label past the ◉/◯ checkbox column.
        if (step.type === 'multi') {
          const active = cursor === step.options.length;
          const arrow = active ? `${ansiStyle('❯', ANSI.cyan)} ` : '  ';
          const label = active ? ansiStyle('Next', ANSI.cyan, ANSI.bold) : ansiStyle('Next', ANSI.dim);
          lines.push(`${arrow}  ${label}`);
        }
        const hint = step.type === 'multi'
          ? '↑/↓ move · space/enter toggle · select Next to continue'
          : '↑/↓ move · enter select';
        lines.push(ansiStyle(`${hint}${pointer > 0 ? ' · ← back' : ''}`, ANSI.dim));
        //? The details affordance gets its OWN line below the nav hint so the row
        //? stays readable (every step carries a `details` block).
        if (step.details !== undefined && step.details !== '') {
          lines.push(ansiStyle(detailsOpen ? 'press ? to hide details' : 'press ? for details', ANSI.dim));
        }
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
      if (key.ctrl === true && key.name === 'c') {
        restoreTerminal();
        output.write('\n');
        process.exit(130);
      }

      //? Review screen: Enter creates the project, ← jumps back to the last step to
      //? edit. Everything else is ignored (no pointer is "active" here).
      if (reviewing) {
        if (key.name === 'return') {
          restoreTerminal();
          resolve(answers);
        } else if (key.name === 'left') {
          reviewing = false;
          pointer = Math.max(0, visibleSteps().length - 1);
          detailsOpen = false;
          paint();
        }
        return;
      }

      const order = visibleSteps();
      const i = order[pointer];
      const step = i === undefined ? undefined : steps[i];
      if (i === undefined || !step) return;

      //? `?` toggles the current step's expandable details block (no-op for steps
      //? without `details`, so the keypress is simply ignored there).
      if (_str === '?') {
        if (step.details !== undefined && step.details !== '') {
          detailsOpen = !detailsOpen;
          paint();
        }
        return;
      }

      //? Multi-select has one extra navigable row (the trailing "Next" action),
      //? so the cursor wraps over options.length + 1; single-select over the
      //? options alone.
      const navCount = step.type === 'multi' ? step.options.length + 1 : step.options.length;
      if (key.name === 'up') {
        cursors[i] = ((cursors[i] ?? 0) - 1 + navCount) % navCount;
        paint();
        return;
      }
      if (key.name === 'down') {
        cursors[i] = ((cursors[i] ?? 0) + 1) % navCount;
        paint();
        return;
      }
      if (key.name === 'left' && pointer > 0) {
        pointer -= 1;
        detailsOpen = false;
        paint();
        return;
      }
      //? Space/Enter semantics. We accept the spacebar as EITHER `key.name ===
      //? 'space'` or the raw ' ' string — some Windows consoles only send the
      //? latter. In multi-select, the cursor on a PROVIDER row toggles it; on the
      //? trailing "Next" row it confirms the step. In single-select, Enter picks
      //? the highlighted option (Space is ignored).
      const cursorPos = cursors[i] ?? 0;
      const spacePressed = key.name === 'space' || _str === ' ';
      const onNextRow = step.type === 'multi' && cursorPos === step.options.length;

      if (step.type === 'multi' && !onNextRow && (spacePressed || key.name === 'return')) {
        const option = step.options[cursorPos];
        const set = selections[i];
        if (option !== undefined && set) {
          if (set.has(option)) set.delete(option);
          else set.add(option);
        }
        paint();
        return;
      }

      const confirmPressed = key.name === 'return' || (onNextRow && spacePressed);
      if (confirmPressed) {
        answers[step.key] = step.type === 'multi'
          ? step.options.filter((option) => selections[i]?.has(option) === true)
          : asOption(step.options[cursorPos], step.options, step.defaultValue ?? step.options[0] ?? '');
        //? Recompute visibility AFTER recording the answer (it may reveal/hide a
        //? conditional step, e.g. OAuth or browser-tooling). Past the last step we
        //? enter the review screen instead of resolving straight away.
        const nextOrder = visibleSteps();
        pointer += 1;
        detailsOpen = false;
        if (pointer >= nextOrder.length) reviewing = true;
        paint();
      }
    }

    //? Every step was supplied via CLI flags — nothing to ask. Resolve with the
    //? presets immediately instead of entering raw-mode with an empty prompt.
    if (visibleSteps().length === 0) {
      resolve(answers);
      return;
    }

    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    output.write('[?25l');
    input.on('keypress', onKey);
    paint();
  });

//? Map the raw wizard answer bag onto a fully-typed `ScaffoldChoices`,
//? validating every provider field against `PROVIDER_OPTIONS` (so an out-of-band
//? value falls back to its default instead of leaking through as an arbitrary
//? string). Centralizes the per-field `asOption` validation that used to be
//? inlined at the return site.
const convertAnswersToChoices = (answers: Record<string, string | string[]>): ScaffoldChoices => {
  const orm = asOption(answers.orm, PROVIDER_OPTIONS.orm, 'prisma');
  //? Constraint (ADR 0020): the default UserAdapter is Prisma-backed, so any
  //? non-prisma orm forces auth off — the wizard skips the auth steps and a
  //? stale/preset auth value must not leak through here.
  const authMode = orm === 'prisma' ? asOption(answers.authMode, PROVIDER_OPTIONS.authMode, 'none') : 'none';
  const rawOauth = answers.oauthProviders;
  const oauthPicked = Array.isArray(rawOauth) ? rawOauth : [];

  //? Drizzle is SQL-only. The wizard's twin db-step prevents this combo
  //? interactively, so reaching it means an explicit `--db=mongodb --orm=drizzle`
  //? flag preset — reject loudly rather than silently scaffolding a broken pair.
  const dbProvider = asOption(
    answers.dbProvider,
    PROVIDER_OPTIONS.dbProvider,
    orm === 'drizzle' ? 'postgresql' : 'mongodb',
  );
  if (!ormSupportsDb(orm, dbProvider)) {
    console.error(`Invalid combination: --orm=${orm} does not support --db=${dbProvider} (drizzle is SQL-only).`);
    console.error(`Pick one of: ${SQL_DB_PROVIDERS.join(', ')} — or use --orm=mikro-orm for a TypeScript-first ORM with MongoDB support.`);
    process.exit(2);
  }

  return {
    orm,
    dbProvider,
    authMode,
    oauthProviders: authMode === 'credentials+oauth'
      ? PROVIDER_OPTIONS.oauthProviders.filter((provider) => oauthPicked.includes(provider))
      : [],
    emailProvider: asOption(answers.emailProvider, PROVIDER_OPTIONS.emailProvider, 'none'),
    monitoringProvider: asOption(answers.monitoringProvider, PROVIDER_OPTIONS.monitoringProvider, 'none'),
    presence: answers.presence === 'Yes',
    //? Opt-in convention (default off): only true when explicitly 'Yes'.
    errorTracking: answers.errorTracking === 'Yes',
    //? Opt-in convention (default off): only true when explicitly 'Yes'.
    docsUi: answers.docsUi === 'Yes',
    secretManager: answers.secretManager === 'Yes',
    router: answers.router === 'Yes',
    aiInstructions: answers.aiInstructions !== 'No',
    //? Browser tooling rides on the AI template — forced 'none' when AI
    //? instructions are excluded (the wizard step is skipped in that case).
    aiBrowserTooling: answers.aiInstructions === 'No'
      ? 'none'
      : asOption(answers.aiBrowserTooling, PROVIDER_OPTIONS.aiBrowserTooling, 'agent-browser'),
  };
};

const runPrompts = async (presets: Record<string, string | string[]> = {}): Promise<ScaffoldChoices> => {
  if (!input.isTTY || !output.isTTY) return runPromptsFallback(presets);

  //? Make the required runtime explicit before the optional toggles below, so it
  //? is clear WHAT is always installed vs WHAT each question opts into.
  output.write(
    `\n${ansiStyle('Always installed', ANSI.bold)} (the framework runtime): ` +
    `${ansiStyle('@luckystack/core, server, api, sync', ANSI.cyan)}.\n` +
    `${ansiStyle('The questions below pick a database + toggle the optional packages and features.', ANSI.dim)}\n`,
  );

  const answers = await runWizard([
    {
      key: 'orm', type: 'select', label: 'Which ORM / data layer?',
      description: 'prisma = classic full setup · drizzle = TS-first SQL · mikro-orm = TS-first incl. MongoDB · none = bring your own.',
      details: [
        '"prisma" ships the classic setup: prisma/schema.prisma, generated client,',
        'prisma:* scripts, all 4 databases, and built-in auth stays available.',
        '"drizzle" = TypeScript-first SQL ORM (postgresql/mysql/sqlite — NO',
        'MongoDB): ships server/db/schema.ts + drizzle.config.ts + drizzle-kit',
        'scripts, and your client lands in functions/db.ts (functions.db.* in',
        'handlers). "mikro-orm" = TypeScript-first with first-class MongoDB (all',
        '4 databases): ships EntitySchema starters + the mikro-orm CLI wiring.',
        '"none" strips every ORM trace and leaves the same hooks empty.',
        'NOTE: everything except prisma forces auth off for now — the built-in',
        'login UserAdapter is Prisma-backed (a custom UserAdapter re-enables it).',
        'Redis stays required in all cases (sessions/rate-limiting run on it).',
      ].join('\n'),
      options: PROVIDER_OPTIONS.orm, defaultValue: 'prisma',
    },
    {
      key: 'dbProvider', type: 'select', label: 'Which database provider?',
      description: 'Your database — schema + client types come from the chosen ORM.',
      details: [
        'Sets the database the chosen ORM connects to (schema file, generated',
        'types, and the DATABASE_URL suggestion in .env.local). With Prisma you',
        'can switch later by editing prisma/schema.prisma and re-running',
        '`npm run prisma:generate`; drizzle/mikro-orm have their own schema files.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.dbProvider, defaultValue: 'mongodb',
      //? Hidden for orm:'none' AND for drizzle — drizzle gets the SQL-only
      //? twin step below (same answer key, complementary skips).
      skip: (a) => a.orm === 'none' || a.orm === 'drizzle',
    },
    {
      key: 'dbProvider', type: 'select', label: 'Which database provider? (drizzle is SQL-only)',
      description: 'Drizzle has no MongoDB support — pick one of the SQL databases.',
      details: [
        'Drizzle ORM only speaks SQL dialects, so MongoDB (the usual default) is',
        'not available under it. Need MongoDB with a TypeScript-first ORM? Go',
        'back and pick mikro-orm instead.',
      ].join('\n'),
      options: SQL_DB_PROVIDERS, defaultValue: 'postgresql',
      skip: (a) => a.orm !== 'drizzle',
    },
    {
      key: 'authMode', type: 'select', label: 'Authentication mode? (@luckystack/login)',
      description: 'Email/password + sessions + optional OAuth. "none" = no auth wired.',
      details: [
        '@luckystack/login. "none" = no auth (anonymous sessions still work).',
        '"credentials" = email/password sign-in + registration + password-reset',
        'pages. "credentials+oauth" = that plus social login (next question picks',
        'the providers). The auth pages/APIs are copied into your src/ to edit.',
        'Add later instead: npx luckystack add login.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.authMode, defaultValue: 'none',
      //? Any non-prisma orm forces auth off (Prisma-backed default UserAdapter).
      skip: (a) => a.orm !== 'prisma' && a.orm !== undefined,
    },
    {
      key: 'oauthProviders', type: 'multi', label: 'Which OAuth providers to wire? (@luckystack/login)',
      description: 'Social-login providers pre-wired into @luckystack/login.',
      details: [
        '@luckystack/login wires each provider purely from env vars',
        '(DEV_<PROVIDER>_CLIENT_ID / _SECRET), so you can add or drop providers',
        'later with no code change — just set/unset the env. Pick the ones to',
        'pre-wire now.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.oauthProviders, skip: (a) => (a.orm !== 'prisma' && a.orm !== undefined) || a.authMode !== 'credentials+oauth',
    },
    {
      key: 'emailProvider', type: 'select', label: 'Transactional email adapter? (@luckystack/email)',
      description: '"none" = not installed · "console" = log to terminal (dev) · resend/smtp = real delivery.',
      details: [
        '@luckystack/email — sends transactional mail (password reset, email',
        'verification). "none" = the package is not installed. "console" = emails',
        'are logged to the terminal (handy in dev, no account needed). "resend" /',
        '"smtp" = real delivery — set the API key / SMTP vars in .env.local.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.emailProvider, defaultValue: 'none',
    },
    {
      key: 'monitoringProvider', type: 'select', label: 'Observability backend? (Sentry/Datadog/PostHog SDK)',
      description: 'WHERE telemetry goes — the backend SDK + .env keys. @luckystack/error-tracking (next) feeds it.',
      details: [
        'Picks the observability BACKEND + its SDK + .env keys (Sentry / Datadog /',
        'PostHog) — i.e. WHERE telemetry ends up. It does not capture anything on',
        'its own: @luckystack/error-tracking (the next question) is the layer that',
        'collects errors and sends them here. "none" = no backend wired.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.monitoringProvider, defaultValue: 'none',
    },
    {
      key: 'presence', type: 'select', label: 'Install @luckystack/presence?',
      description: 'Live presence, AFK detection + a socket-status indicator.',
      details: [
        '@luckystack/presence — shows who is online, detects AFK/idle, and renders',
        'a live socket-status indicator. Adds a <LocationProvider/> + the indicator',
        'to your client. Skip it if your app has no real-time/presence needs.',
        'Add later instead: npx luckystack add presence.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'No',
    },
    {
      key: 'errorTracking', type: 'select', label: 'Install @luckystack/error-tracking?',
      description: 'Auto-captures errors and feeds the backend above. Press ? — important if you picked backend "none".',
      details: [
        '@luckystack/error-tracking is a thin layer the framework auto-wires into',
        'every API + sync call: it captures thrown errors, adds request/timing',
        'spans, and tags the current user — with zero code in your handlers.',
        '',
        'It does NOT store anything itself; it FORWARDS to a backend. Two cases:',
        ' • You picked a backend above (Sentry/PostHog/Datadog) → errors flow there.',
        ' • You picked "none" → there is nowhere to send, so this package stays a',
        '   no-op. Only useful then if you register your own captureException sink',
        '   in code.',
        '',
        'So install it together with a backend (or your own sink). It is safe to',
        'leave on — dormant until a DSN/key is set. Skip it for a backend-free app.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'No',
    },
    {
      key: 'docsUi', type: 'select', label: 'Install @luckystack/docs-ui?',
      description: 'In-app viewer for your generated API docs at /_docs (dev).',
      details: [
        '@luckystack/docs-ui — mounts an in-app viewer for your auto-generated API',
        'docs at /_docs (development). The backend self-wires the moment the package',
        'is installed (its ./register subpath), so no code edit is needed. Disabled',
        'in production by default.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'No',
    },
    {
      key: 'secretManager', type: 'select', label: 'Install @luckystack/secret-manager?',
      description: 'Commit POINTERS in .env, resolve real secrets from a remote server at boot.',
      details: [
        '@luckystack/secret-manager — keeps real secrets OUT of your repo: you',
        'commit POINTERS in .env (NAME=BASE_V<n>) and the package resolves them from',
        'an external secret server at boot. Choosing Yes adds the dep and uncomments',
        'its config.ts + server.ts blocks; it stays dormant until you set',
        'LUCKYSTACK_SECRET_MANAGER_URL. Skip it unless you run a secret server.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'No',
    },
    {
      key: 'router', type: 'select', label: 'Install @luckystack/router?',
      description: 'Separate multi-instance load-balancer process (npm run router). Only for scaling out.',
      details: [
        '@luckystack/router — a SEPARATE load-balancer process (run via',
        '`npm run router`) that routes traffic across multiple server instances. You',
        'only need it when you scale out to multi-instance; a single-server app never',
        'runs it. The routing topology lives in your deploy.config.ts. Adds the dep',
        '+ the run script.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'No',
    },
    {
      key: 'aiInstructions', type: 'select', label: 'Include LuckyStack AI dev instructions?',
      description: 'CLAUDE.md + docs + git hook + the @luckystack/mcp graph server for AI agents.',
      details: [
        'Copies LuckyStack\'s AI dev-context into the project: the root CLAUDE.md,',
        'the docs/luckystack deep-dives, skills, and a pre-commit git hook that keeps',
        'the AI index/graph fresh. Also registers @luckystack/mcp in .mcp.json so AI',
        'agents can query your dependency graph (blast_radius / who_imports). No',
        'app-runtime weight — pure dev tooling.',
      ].join('\n'),
      options: ['Yes', 'No'], defaultValue: 'Yes',
    },
    {
      key: 'aiBrowserTooling', type: 'select', label: 'Set up AI browser-testing tooling?',
      description: 'agent-browser = cheap CLI · all = + Playwright/Chrome DevTools MCP · none = skip.',
      details: [
        'AI browser-testing tooling (external tools, not a @luckystack package).',
        '"agent-browser" = the cheap CLI for interactive verification. "all" = also',
        'wires the Playwright + Chrome DevTools MCP servers for cross-browser / perf',
        'checks. "none" = skip. Only applies when AI dev instructions are on.',
      ].join('\n'),
      options: PROVIDER_OPTIONS.aiBrowserTooling, defaultValue: 'agent-browser', skip: (a) => a.aiInstructions === 'No',
    },
  ], presets);

  return convertAnswersToChoices(answers);
};

//? Build the wizard/fallback answer-bag from CLI flags (CFG-01). Only keys that
//? were actually passed are set, so unspecified options still get asked (or fall
//? to defaults under `--no-prompt`). Booleans map to the wizard's Yes/No vocab.
const buildPresetAnswers = (args: CliArgs): Record<string, string | string[]> => {
  const presets: Record<string, string | string[]> = {};
  if (args.orm) presets.orm = args.orm;
  if (args.dbProvider) presets.dbProvider = args.dbProvider;
  if (args.authMode) presets.authMode = args.authMode;
  if (args.oauthProviders) presets.oauthProviders = args.oauthProviders;
  if (args.emailProvider) presets.emailProvider = args.emailProvider;
  if (args.monitoringProvider) presets.monitoringProvider = args.monitoringProvider;
  if (args.presence) presets.presence = 'Yes';
  if (args.errorTracking) presets.errorTracking = 'Yes';
  if (args.docsUi) presets.docsUi = 'Yes';
  if (args.secretManager) presets.secretManager = 'Yes';
  if (args.router) presets.router = 'Yes';
  if (args.aiInstructions !== null) presets.aiInstructions = args.aiInstructions ? 'Yes' : 'No';
  if (args.aiBrowserTooling) presets.aiBrowserTooling = args.aiBrowserTooling;
  return presets;
};

//? Enforce the cross-field invariants the wizard's `convertAnswersToChoices`
//? guarantees, for the `--no-prompt` (flags-over-defaults) path: OAuth providers
//? only matter under `credentials+oauth`, and browser tooling rides on the AI
//? template. Keeps both choice-resolution paths consistent.
const normalizeChoices = (choices: ScaffoldChoices): ScaffoldChoices => {
  //? Any non-prisma orm forces auth off (Prisma-backed default UserAdapter — ADR 0020).
  const authMode = choices.orm === 'prisma' ? choices.authMode : 'none';
  return {
    ...choices,
    authMode,
    oauthProviders: authMode === 'credentials+oauth' ? choices.oauthProviders : [],
    aiBrowserTooling: choices.aiInstructions ? choices.aiBrowserTooling : 'none',
  };
};

//? `--no-prompt` choice resolution: typed flag values layered over DEFAULT_CHOICES.
const buildNoPromptChoices = (args: CliArgs): ScaffoldChoices => {
  const choices: ScaffoldChoices = { ...DEFAULT_CHOICES };
  if (args.orm) choices.orm = args.orm;
  if (args.dbProvider) choices.dbProvider = args.dbProvider;
  //? Drizzle is SQL-only: an EXPLICIT `--db=mongodb --orm=drizzle` is a hard
  //? reject; the implicit case (mongodb only as the untouched default) falls
  //? back to postgresql so `--no-prompt --orm=drizzle` works out of the box.
  if (choices.orm === 'drizzle' && choices.dbProvider === 'mongodb') {
    if (args.dbProvider) {
      console.error('Invalid combination: --orm=drizzle does not support --db=mongodb (drizzle is SQL-only).');
      console.error(`Pick one of: ${SQL_DB_PROVIDERS.join(', ')} — or use --orm=mikro-orm for a TypeScript-first ORM with MongoDB support.`);
      process.exit(2);
    }
    choices.dbProvider = 'postgresql';
    console.log("orm=drizzle has no MongoDB support — database defaulted to 'postgresql'.");
  }
  if (args.authMode) choices.authMode = args.authMode;
  if (args.oauthProviders) choices.oauthProviders = args.oauthProviders;
  if (args.emailProvider) choices.emailProvider = args.emailProvider;
  if (args.monitoringProvider) choices.monitoringProvider = args.monitoringProvider;
  if (args.presence) choices.presence = true;
  if (args.errorTracking) choices.errorTracking = true;
  if (args.docsUi) choices.docsUi = true;
  if (args.secretManager) choices.secretManager = true;
  if (args.router) choices.router = true;
  if (args.aiInstructions !== null) choices.aiInstructions = args.aiInstructions;
  if (args.aiBrowserTooling) choices.aiBrowserTooling = args.aiBrowserTooling;
  return normalizeChoices(choices);
};

const printHelp = (): void => {
  console.log(`
create-luckystack-app — scaffold a new LuckyStack project

Usage:
  npx create-luckystack-app <project-name> [options]

Options:
  --no-install   Don't run \`npm install\` or \`npx prisma generate\` after copying.
  --no-prompt    Skip the interactive prompts and use defaults + any flags below.

  Scaffold choices (each pre-fills the matching wizard step, or applies under --no-prompt):
  Lean by default: every optional package/feature is OFF unless you opt in below.
  --orm=<prisma|drizzle|mikro-orm|none>       Data layer (default prisma). drizzle = TypeScript-first
                                              SQL ORM (no MongoDB); mikro-orm = TypeScript-first incl.
                                              MongoDB; none = bring your own client via functions/db.ts.
                                              Non-prisma forces --auth=none (Prisma-backed UserAdapter).
  --db=<mongodb|postgresql|mysql|sqlite>      Database provider (default mongodb).
  --auth=<none|credentials|credentials+oauth> Authentication mode (default 'none' = no auth).
  --oauth=<google,github,discord,facebook,microsoft>  OAuth providers (comma list; needs --auth=credentials+oauth).
  --email=<none|console|resend|smtp>          Transactional email adapter (default 'none').
  --monitoring=<none|sentry|datadog|posthog>  Observability backend (default 'none').
  --presence     Install @luckystack/presence (AFK / presence / socket-status).
  --error-tracking  Install @luckystack/error-tracking (error capture + auto-instrumentation).
  --docs-ui      Install @luckystack/docs-ui (in-app API docs viewer).
  --secret-manager  Install @luckystack/secret-manager (.env-pointer secrets).
  --router       Install @luckystack/router (multi-instance load-balancer; npm run router).
  --ai-docs / --no-ai-docs   Include / omit LuckyStack AI dev instructions (default on).
  --ai-browser=<all|agent-browser|none>
                 AI browser-testing tooling (default agent-browser). 'all' also wires the
                 Playwright + Chrome DevTools MCP servers. Needs the AI instructions on.
  --help, -h     Show this message.

Example:
  npx create-luckystack-app my-app
  npx create-luckystack-app my-app --no-prompt --no-install
  npx create-luckystack-app my-app --no-prompt --db=postgresql --auth=credentials+oauth --oauth=google,github --email=resend --monitoring=sentry
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

//? Comment prefix for an `.env.local` line: empty when the provider is active
//? (the developer fills the value in), `# ` when it's an enable-later stub.
const commentPrefix = (active: boolean): string => (active ? '' : '# ');

//? Declarative `.env.local` provider registry. Each provider owns the exact
//? lines it contributes, parameterized only by whether it's the active choice.
//? One `buildProviderEnvBlocks` renderer walks a spec list and joins the blocks,
//? so OAuth and monitoring no longer hand-roll their own per-provider loops and
//? a new provider is declared in exactly one place.
interface EnvProviderSpec {
  id: string;
  /** Lines this provider emits given its active/inactive state. */
  lines: (active: boolean) => string[];
}

//? One EnvVarBuilder: render the given provider specs (active = matches the
//? selection predicate) into `\n\n`-separated blocks.
const buildProviderEnvBlocks = (
  specs: readonly EnvProviderSpec[],
  isActive: (id: string) => boolean,
): string => specs.map((spec) => spec.lines(isActive(spec.id)).join('\n')).join('\n\n');

//? Per selected OAuth provider, emit BOTH a `DEV_*` pair (read when NODE_ENV !==
//? production) and an unprefixed pair (read in production) — matching the
//? env-driven registry in `luckystack/login/oauthProviders.ts`. Left uncommented
//? with empty values so the developer only fills them in; the provider stays
//? disabled (no login button, no /auth route) until BOTH its id and secret are
//? set — no code edit required to enable it.
//? Every built-in provider `oauthProviders.ts` wires by env. We always emit a
//? block for each so unselected ones are visible (commented) and enable-later is
//? a one-line uncomment — mirroring the email / monitoring blocks below.
const OAUTH_ENV_PROVIDERS: readonly EnvProviderSpec[] = PROVIDER_OPTIONS.oauthProviders.map((provider) => ({
  id: provider,
  lines: (active) => {
    const upper = provider.toUpperCase();
    const c = commentPrefix(active);
    const out = [
      active ? `# ${provider} (active)` : `# ${provider} (enable later)`,
      `${c}DEV_${upper}_CLIENT_ID=`,
      `${c}DEV_${upper}_CLIENT_SECRET=`,
      `${c}${upper}_CLIENT_ID=`,
      `${c}${upper}_CLIENT_SECRET=`,
    ];
    //? Microsoft needs a tenant ('common' for multi-tenant). Default it so the
    //? provider works out of the box once id + secret are filled.
    if (provider === 'microsoft') out.push(`${c}MICROSOFT_TENANT_ID=common`);
    return out;
  },
}));

export const buildOAuthEnvVars = (providers: readonly string[], authMode: string): string => {
  //? authMode 'none' = @luckystack/login is NOT installed, so there's no login
  //? form, no /auth/callback route, and nothing that reads these vars. Emitting
  //? the full "fill a pair to enable" block would be misleading, so replace it
  //? with a one-line pointer to `npx luckystack add login`.
  if (authMode === 'none') {
    return '# OAuth: requires auth — run `npx luckystack add login` first, then set the provider credentials here.';
  }

  const selected = new Set(providers);
  const intro = [
    '# OAuth client secrets. Just fill in a provider\'s id + secret and restart — the',
    '# button appears on the login form automatically and its /auth/callback route',
    '# works. No code edit needed: @luckystack/login/register already wires every',
    '# built-in provider from env at boot. Providers you picked at scaffold time are',
    '# uncommented; the rest are commented out — fill a pair and uncomment to enable',
    '# later. DEV_* are read when NODE_ENV is not "production"; the unprefixed pair is',
    '# read in production. A provider stays disabled until BOTH its id and secret are set.',
    '#',
    '# The login page reads GET /auth/providers, which lists a provider ONLY when BOTH',
    '# its id and secret are non-empty. EMPTY a provider\'s id/secret here (and restart)',
    '# → its button disappears from /login. (Make sure the same keys are not ALSO set',
    '# in `.env`, or the button will stay — see the one-file-per-key note at the top.)',
    '#',
    '# IMPORTANT — Authorized redirect URI (fixes "Error 400: redirect_uri_mismatch"):',
    '# /auth/callback/<provider> is a BACKEND route, so register the BACKEND origin in',
    '# the provider\'s developer console (Google Cloud, GitHub OAuth App, …) — in dev',
    '# that\'s SERVER_IP:SERVER_PORT:',
    '#     http://localhost:80/auth/callback/google',
    '# In production use your domain: https://your-domain.com/auth/callback/google',
    '# It must match character-for-character (scheme, host, port). Also add the',
    '# provider\'s origin to EXTERNAL_ORIGINS in `.env`.',
  ].join('\n');

  const blocks = buildProviderEnvBlocks(OAUTH_ENV_PROVIDERS, (id) => selected.has(id));
  return [intro, blocks].join('\n\n');
};

//? Monitoring provider registry: drives BOTH the `.env.local` block (below) AND
//? the npm deps injected for the selected provider (`injectOptionalDeps`), so a
//? new observability backend is declared once instead of in two tandem-edited
//? tables. Sentry/PostHog wire from the `luckystack/` overlays by env; Datadog
//? also needs the dd-trace block in server/server.ts.
interface MonitoringProviderSpec extends EnvProviderSpec {
  /** npm deps to add to the scaffold when this provider is the selected one. */
  deps: Record<string, string>;
}

const MONITORING_PROVIDERS: readonly MonitoringProviderSpec[] = [
  {
    id: 'sentry',
    deps: { '@sentry/node': '^10.48.0' },
    lines: (active) => active
      ? ['# Sentry (active) — set the DSN + restart. Requires `npm i @sentry/node`.',
        '# Captures in all environments once the DSN is set; SENTRY_ENABLED=false opts out.',
        'SENTRY_DSN=', '# SENTRY_ENABLED=false']
      : ['# Sentry (enable later): npm i @sentry/node, then set SENTRY_DSN + restart.',
        '# SENTRY_DSN=', '# SENTRY_ENABLED=false'],
  },
  {
    id: 'posthog',
    deps: { 'posthog-node': '^4.0.0' },
    lines: (active) => active
      ? ['# PostHog (active) — set the key + restart. Requires `npm i posthog-node`.',
        'POSTHOG_KEY=', 'POSTHOG_HOST=https://us.i.posthog.com']
      : ['# PostHog (enable later): npm i posthog-node, then set POSTHOG_KEY + restart.',
        '# POSTHOG_KEY=', '# POSTHOG_HOST=https://us.i.posthog.com'],
  },
  {
    id: 'datadog',
    deps: { 'dd-trace': '^5.0.0', 'hot-shots': '^10.0.0' },
    lines: (active) => active
      ? ['# Datadog (active) — set the keys AND uncomment the dd-trace block at the top',
        '# of server/server.ts (dd-trace must load first). Requires `npm i dd-trace hot-shots`.',
        'DD_API_KEY=', 'DD_SITE=datadoghq.com', '# DD_TRACE_AGENT_URL=']
      : ['# Datadog (enable later): npm i dd-trace hot-shots, uncomment the dd-trace block',
        '# in server/server.ts, then set DD_API_KEY (+ DD_SITE).',
        '# DD_API_KEY=', '# DD_SITE=datadoghq.com'],
  },
];

//? Observability env block for `.env.local`. Each provider is enable-later: the
//? SELECTED one gets uncommented (empty) keys to fill, the others stay commented
//? with their `npm i` + restart steps.
export const buildMonitoringEnvVars = (provider: string): string =>
  buildProviderEnvBlocks(MONITORING_PROVIDERS, (id) => id === provider);

//? Email adapter specs (resend / smtp). Email's layout interleaves blank-line
//? separators and shares a trailing EMAIL_FROM line, so it composes these blocks
//? directly rather than via `buildProviderEnvBlocks` (which `\n\n`-joins).
const EMAIL_ADAPTERS: readonly EnvProviderSpec[] = [
  {
    id: 'resend',
    lines: (active) => [
      active
        ? '# Resend (active) — set your API key. Requires `npm i resend`.'
        : '# Resend (enable later): npm i resend, then set RESEND_API_KEY.',
      `${commentPrefix(active)}RESEND_API_KEY=`,
    ],
  },
  {
    id: 'smtp',
    lines: (active) => {
      const c = commentPrefix(active);
      return [
        active
          ? '# SMTP (active) — set host + credentials. Requires `npm i nodemailer`.'
          : '# SMTP (enable later): npm i nodemailer, then set SMTP_HOST (+ user/pass).',
        `${c}SMTP_HOST=`, `${c}SMTP_PORT=587`, `${c}SMTP_SECURE=false`, `${c}SMTP_USER=`, `${c}SMTP_PASS=`,
      ];
    },
  },
];

//? Email env block for `.env.local`. Email turns on as soon as @luckystack/email
//? is installed (luckystack/email/init.ts auto-registers the sender). The chosen
//? adapter's keys are uncommented; the alternatives stay commented enable-later.
export const buildEmailEnvVars = (provider: string): string => {
  const anyActive = provider === 'resend' || provider === 'smtp' || provider === 'console';

  let intro: string[] = [];
  if (provider === 'console') {
    intro = ['# Console sender (dev) is active — emails are logged to the terminal because',
      '# @luckystack/email is installed. Set Resend or SMTP below for real delivery.'];
  } else if (provider === 'none') {
    intro = ['# Email is OFF. Enable it: npm i @luckystack/email (+ `resend` or `nodemailer`),',
      '# set the keys below, and restart — luckystack/email/init.ts then registers the',
      '# sender (Resend if RESEND_API_KEY set, else SMTP if SMTP_HOST set, else Console).'];
  }

  const adapterLines = EMAIL_ADAPTERS.flatMap((adapter) => ['', ...adapter.lines(adapter.id === provider)]);

  return [
    ...intro,
    ...adapterLines,
    '',
    '# Default From address for outgoing mail.',
    `${commentPrefix(anyActive)}EMAIL_FROM=noreply@example.com`,
  ].join('\n');
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

    //? Skip symlinks to avoid cycles and to keep the scaffold output self-contained.
    if (entry.isSymbolicLink()) continue;

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

//? Resolve a bare command name (`npm`/`npx`) to an ABSOLUTE path by scanning
//? `PATH` only — the current directory is intentionally NOT searched, so an
//? `npm.cmd` / `npx.cmd` dropped in the freshly-scaffolded project root can never
//? be picked up (BatBadBut-class hazard). On Windows we try each `PATHEXT`
//? extension; elsewhere the bare name. Mirrors `@luckystack/cli`'s resolver.
const resolveCommandPath = (command: string): string | null => {
  const rawPath = process.env.PATH ?? process.env.Path ?? '';
  const dirs = rawPath.split(path.delimiter).filter((d) => d.length > 0);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e.length > 0)
      : [''];
  for (const dir of dirs) {
    //? A relative PATH entry could still resolve against cwd — skip those.
    if (!path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext.toLowerCase());
      const candidateUpper = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) return candidate;
      if (candidateUpper !== candidate && fs.existsSync(candidateUpper)) return candidateUpper;
    }
  }
  return null;
};

//? Windows-safe spawn of a resolved `.cmd`/`.bat` shim (npm/npx). A bare
//? `spawnSync(resolved, args, { shell: true })` joins `resolved` + args into ONE
//? cmd string and cmd splits the standard `C:\Program Files\nodejs\npm.cmd` on
//? its space ("'C:\Program' is not recognized" → install/generate silently fail).
//? Invoke comspec with the path in an OUTER+INNER quote pair: with `/s`, cmd
//? strips the OUTER pair and runs the rest verbatim, so the inner pair keeps the
//? spaced path intact. `windowsVerbatimArguments` stops cmd from re-quoting.
const spawnResolved = (resolved: string, args: readonly string[], cwd: string): ReturnType<typeof spawnSync> => {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
  if (needsShell) {
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    return spawnSync(comspec, ['/d', '/s', '/c', `""${resolved}" ${args.join(' ')}"`], {
      cwd,
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(resolved, [...args], { cwd, stdio: 'inherit' });
};

const runNpmInstall = (cwd: string): void => {
  console.log('\nInstalling dependencies (this may take a minute)...\n');
  const resolved = resolveCommandPath('npm');
  if (!resolved) {
    console.error('\n[create-luckystack-app] Could not locate `npm` on PATH. Run `npm install` manually in the project directory.');
    return;
  }
  const result = spawnResolved(resolved, ['install'], cwd);
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
  const resolved = resolveCommandPath('npx');
  if (!resolved) {
    console.error('\n[create-luckystack-app] Could not locate `npx` on PATH. Run `npx prisma generate` manually after setting DATABASE_URL.');
    return;
  }
  const result = spawnResolved(resolved, ['prisma', 'generate'], cwd);
  if (result.status !== 0) {
    console.error('\n[create-luckystack-app] `npx prisma generate` failed. Run it manually after setting DATABASE_URL.');
  }
};

//? Pre-commit hook that regenerates the consumer's AI snapshot files
//? (docs/AI_QUICK_INDEX.md + docs/AI_CAPABILITIES.md + docs/AI_PROJECT_INDEX.md
//? + docs/AI_DECISIONS_INDEX.md + docs/AI_RUNBOOKS.md + docs/AI_PRODUCT_OVERVIEW.md
//? + docs/ai-graph.json) and stages them, so they never drift. Derived from the
//? framework repo's own hook; extend here when new AI index scripts are added. Wired via a
//? `prepare` script setting `core.hooksPath` at install time (no-op when the
//? project isn't a git repo yet — the hook activates after `git init`).
const AI_INDEX_HOOK = `#!/bin/sh
#? Auto-installed by create-luckystack-app. Regenerates LuckyStack's AI snapshot
#? files so they stay in sync with this commit, then stages them. The generators
#? are deterministic (no timestamps), so a no-op commit leaves them unchanged.
if ! command -v npm >/dev/null 2>&1; then
  echo "[pre-commit] npm not on PATH — skipping AI snapshot regeneration."
  exit 0
fi
#? Skip gracefully before the first \`npm install\` so the very first commit on
#? a fresh scaffold isn't hard-blocked. \`set -e\` is armed below, after the
#? guards, so failures in the generators DO abort the commit.
if [ ! -d node_modules ]; then
  echo "[pre-commit] node_modules not found — skipping AI snapshot regeneration (run npm install first)."
  exit 0
fi
set -e
echo "[pre-commit] Checking CLAUDE.md invariants on staged changes..."
npm run ai:lint --silent
echo "[pre-commit] Regenerating docs/AI_CAPABILITIES.md..."
npm run ai:capabilities --silent
echo "[pre-commit] Regenerating docs/AI_PROJECT_INDEX.md..."
npm run ai:project-index --silent
echo "[pre-commit] Regenerating docs/AI_DECISIONS_INDEX.md..."
npm run ai:decisions --silent
echo "[pre-commit] Regenerating docs/AI_LESSONS_INDEX.md..."
npm run ai:lessons --silent
echo "[pre-commit] Regenerating docs/AI_EXAMPLES_INDEX.md..."
npm run ai:examples --silent
echo "[pre-commit] Regenerating docs/AI_RUNBOOKS.md..."
npm run ai:runbooks --silent
echo "[pre-commit] Regenerating docs/AI_PRODUCT_OVERVIEW.md..."
npm run ai:product --silent
echo "[pre-commit] Regenerating docs/ai-graph.json..."
npm run ai:graph --silent
echo "[pre-commit] Regenerating docs/AI_CONTEXT_BUDGET.md..."
npm run ai:context-budget --silent
echo "[pre-commit] Checking hand-written doc staleness (report-only)..."
npm run ai:doc-staleness --silent || true
git add docs/AI_CAPABILITIES.md docs/AI_PROJECT_INDEX.md docs/AI_DECISIONS_INDEX.md docs/AI_LESSONS_INDEX.md docs/AI_EXAMPLES_INDEX.md docs/AI_RUNBOOKS.md docs/AI_PRODUCT_OVERVIEW.md docs/ai-graph.json docs/AI_CONTEXT_BUDGET.md
git add docs/ai-product 2>/dev/null || true
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
  let pkg: { name?: string; scripts?: Record<string, string | undefined> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
    if (typeof pkg.name !== 'string') throw new Error('package.json missing name field');
  } catch {
    console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping prepare script injection.`);
    return;
  }
  pkg.scripts ??= {};
  pkg.scripts.prepare ??= "node -e \"try{require('child_process').execSync('git config core.hooksPath .githooks',{stdio:'ignore'})}catch{}\"";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

//? Add the npm deps the SELECTED monitoring + email providers need, so the chosen
//? integration is installed and ready to use (the developer only fills in env).
//? Non-selected providers stay enable-later behind a single `npm i` documented in
//? the `.env.local` comments. No-op when both choices are 'none'. Monitoring deps
//? come from the `MONITORING_PROVIDERS` registry that also drives the env block,
//? so a new backend is declared in one place.
const injectOptionalDeps = (targetDir: string, choices: ScaffoldChoices, luckystackVersion: string): void => {
  const monitoringDeps = MONITORING_PROVIDERS.find((spec) => spec.id === choices.monitoringProvider)?.deps ?? {};
  const deps: Record<string, string> = { ...monitoringDeps };
  const devDeps: Record<string, string> = {};

  if (choices.emailProvider !== 'none') {
    deps['@luckystack/email'] = `^${luckystackVersion}`;
    if (choices.emailProvider === 'resend') deps.resend = '^6.0.0';
    if (choices.emailProvider === 'smtp') {
      deps.nodemailer = '^6.9.0';
      devDeps['@types/nodemailer'] = '^6.4.0';
    }
  }

  //? Opt-in @luckystack packages not shipped in the base template. The backend
  //? self-wires docs-ui via bootstrap auto-detect; secret-manager stays dormant
  //? until its `.env` pointers + server URL are configured (the commented config.ts
  //? / server.ts / .env blocks ship in the template as the enable-later guide).
  if (choices.docsUi) deps['@luckystack/docs-ui'] = `^${luckystackVersion}`;
  if (choices.secretManager) deps['@luckystack/secret-manager'] = `^${luckystackVersion}`;

  if (Object.keys(deps).length === 0 && Object.keys(devDeps).length === 0) return;

  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
    if (typeof pkg.name !== 'string') throw new Error('package.json missing name field');
  } catch {
    console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping optional dep injection.`);
    return;
  }
  pkg.dependencies = { ...pkg.dependencies, ...deps };
  if (Object.keys(devDeps).length > 0) {
    pkg.devDependencies = { ...pkg.devDependencies, ...devDeps };
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

//? Drop an internal @luckystack/* dependency line from the scaffolded package.json.
const dropDependency = (targetDir: string, depName: string): void => {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg: { name?: string; dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
    if (typeof pkg.name !== 'string') throw new Error('package.json missing name field');
  } catch {
    console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping dependency drop for "${depName}".`);
    return;
  }
  if (pkg.dependencies && depName in pkg.dependencies) {
    const { [depName]: _removed, ...rest } = pkg.dependencies;
    pkg.dependencies = rest;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
};

//? Delete a file or directory (recursively) from the scaffolded project. Used
//? by the choice-gated prunes (e.g. `authMode: 'none'` removes auth pages/APIs).
//? A missing path is a silent no-op so the prune is idempotent. `relPath` is
//? always repo-internal (built from literals here), never user input.
const removeScaffoldPath = (targetDir: string, relPath: string): void => {
  const full = path.join(targetDir, relPath);
  const rel = path.relative(targetDir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`[create-luckystack-app] removeScaffoldPath: path escapes targetDir: ${relPath}`);
  }
  fs.rmSync(full, { recursive: true, force: true });
};

//? ─────────────────── AI browser-testing tooling ───────────────────
//? Skill stub pointing the AI at the always-current official agent-browser
//? skill (the framework doesn't pin a version — the upstream skill is the
//? source of truth for invocations). Distinct from `skills/custom/agent-browser`
//? (which GENERATES committed E2E tests); this stub is for INTERACTIVE dev verify.
const AGENT_BROWSER_SKILL_STUB = `---
description: Interactive AI browser verification with agent-browser (navigate/click/fill/screenshot/console). Cheapest-first; always propose + get user approval before driving a browser. See docs/luckystack/AI_BROWSER_TESTING.md.
---

# agent-browser (interactive verification)

Use the **agent-browser** CLI to verify a frontend flow against the LOCAL dev server.
Always announce the action and get explicit user approval first (see the "AI Browser
Testing" section of CLAUDE.md + docs/luckystack/AI_BROWSER_TESTING.md).

## Setup (once, developer action)
- Install: \`npm i -g agent-browser && agent-browser install\` (fetches Chrome-for-Testing), OR
- Get the always-current usage skill: \`npx skills add vercel-labs/agent-browser\` then
  \`agent-browser skills get core\`.

## Guardrails (shipped \`agent-browser.json\`)
- \`allowedDomains: ["localhost","127.0.0.1"]\` — fenced to the dev server.
- \`confirmActions: ["click","fill","navigate"]\` — per-action confirmation.

## When NOT this tool
- Cross-browser / mobile rendering or a real vision styling judgement → Playwright MCP.
- Lighthouse / performance traces → Chrome DevTools MCP.
- Generating COMMITTED tests/audits → the \`/agent-browser\`, \`/lighthouse\`, \`/a11y-audit\` skills.
`;

const PLAYWRIGHT_EXAMPLE_SPEC = `import { test, expect } from '@playwright/test';

//? Deterministic CI complement: after agent-browser confirms a flow interactively,
//? capture it here as a committed @playwright/test spec (no LLM in the CI loop).
//? Start the dev server first (npm run server + npm run client). Remove this file
//? if you don't want the @playwright/test layer.
test('home page loads', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page).toHaveTitle(/.+/);
});
`;

//? Read-or-create a JSON file in the scaffold, apply a merge, write it back
//? pretty-printed. Used for the additive .mcp.json / .claude/settings.json wiring.
const mergeJsonFile = (filePath: string, mutate: (data: Record<string, unknown>) => void): void => {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      //? Treat a corrupted file as empty so a bad scaffold output doesn't abort.
      console.warn(`[create-luckystack-app] Could not parse ${filePath} — treating as empty.`);
    }
  }
  mutate(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

//? Add entries to permissions.ask (set-union — deny-by-default for browser tools).
const addAskPermissions = (data: Record<string, unknown>, entries: string[]): void => {
  const permissions = (data.permissions ??= {}) as Record<string, unknown>;
  const ask = (permissions.ask ??= []) as string[];
  for (const entry of entries) {
    if (!ask.includes(entry)) ask.push(entry);
  }
};

//? Wire the opt-in AI browser-testing tooling into the scaffold. Additive +
//? user-approval-gated; dev-tools only. 'none' → no-op. 'agent-browser' →
//? the cheap CLI + its skill stub + guardrails + an ask-gate. 'all' → also
//? the Playwright + Chrome DevTools MCP servers (.mcp.json) + their ask-gates
//? + the @playwright/test CI layer.
const wireAiBrowserTooling = (targetDir: string, choices: ScaffoldChoices): void => {
  if (choices.aiBrowserTooling === 'none') return;
  const wantAll = choices.aiBrowserTooling === 'all';

  //? Layer 3 — agent-browser's own domain fence + per-action confirmation.
  fs.writeFileSync(
    path.join(targetDir, 'agent-browser.json'),
    `${JSON.stringify({ allowedDomains: ['localhost', '127.0.0.1'], confirmActions: ['click', 'fill', 'navigate'] }, null, 2)}\n`,
  );

  //? Interactive-verify skill stub (official skill is the always-current source).
  const skillDir = path.join(targetDir, '.claude', 'skills', 'agent-browser');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), AGENT_BROWSER_SKILL_STUB);

  //? Layer 2 — deny-by-default permission gate so the harness prompts even if
  //? the AI forgets the CLAUDE.md rule.
  const askEntries = ['Bash(agent-browser:*)', ...(wantAll ? ['mcp__playwright', 'mcp__chrome-devtools'] : [])];
  mergeJsonFile(path.join(targetDir, '.claude', 'settings.json'), (data) => { addAskPermissions(data, askEntries); });

  if (wantAll) {
    //? Claude Code auto-reads project-root .mcp.json. Both servers active by
    //? default (token cost accepted); a user trims by deleting a server here.
    mergeJsonFile(path.join(targetDir, '.mcp.json'), (data) => {
      const servers = (data.mcpServers ??= {}) as Record<string, unknown>;
      //? Pin to minor ranges so a breaking MCP API change doesn't silently
      //? break the scaffolded project on the next npx invocation.
      servers.playwright ??= { type: 'stdio', command: 'npx', args: ['@playwright/mcp@^0.0.29'] };
      servers['chrome-devtools'] ??= { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@^0.5.0'] };
    });

    //? Deterministic CI complement (devDep + one example spec).
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      let pkg: { name?: string; devDependencies?: Record<string, string> } | undefined;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
        if (typeof pkg?.name !== 'string') throw new Error('package.json missing name field');
      } catch {
        console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping @playwright/test injection.`);
      }
      if (pkg) {
        pkg.devDependencies = { ...pkg.devDependencies, '@playwright/test': '^1.50.0' };
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      }
    }
    const e2eDir = path.join(targetDir, 'tests', 'e2e');
    fs.mkdirSync(e2eDir, { recursive: true });
    fs.writeFileSync(path.join(e2eDir, 'example.spec.ts'), PLAYWRIGHT_EXAMPLE_SPEC);
  }

  console.log(`AI browser tooling wired: ${choices.aiBrowserTooling}.`);
};

//? Apply ordered string edits to a scaffolded file. Throws loudly if a `find`
//? token is absent so template drift surfaces during the smoke scaffold instead
//? of producing a broken project — every edit must match exactly once.
//? Silent no-op when the file doesn't exist — intentional: an earlier prune
//? may have removed the file (e.g. authMode:'none' removes settings/page.tsx
//? before a later prune tries to edit it).
const editScaffoldFile = (targetDir: string, relPath: string, edits: readonly [string, string][]): void => {
  const filePath = path.join(targetDir, relPath);
  if (!fs.existsSync(filePath)) return;
  //? Normalize to LF so our `\n`-bearing match tokens work regardless of the
  //? checkout's line endings (Windows copies template files as CRLF). Restore
  //? CRLF on write-back when the file was CRLF so we don't leave a whole-file
  //? LF diff in an otherwise CRLF scaffold.
  const original = fs.readFileSync(filePath, 'utf8');
  const wasCrlf = original.includes('\r\n');
  let content = original.replaceAll('\r\n', '\n');
  for (const [find, replace] of edits) {
    //? A token must match EXACTLY once. Zero matches means template drift broke
    //? the edit; multiple matches mean the token is ambiguous and a `replaceAll`
    //? would silently mutate more than intended — both should surface during the
    //? smoke scaffold rather than produce a subtly-broken project.
    const occurrences = content.split(find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `[create-luckystack-app] prune edit failed — token matched ${String(occurrences)}× (expected exactly 1) in ${relPath}:\n${find}`,
      );
    }
    content = content.replaceAll(find, replace);
  }
  if (wasCrlf) content = content.replaceAll('\n', '\r\n');
  fs.writeFileSync(filePath, content);
};

//? Strip @luckystack/presence and the handful of files that reference it.
const prunePresence = (targetDir: string): void => {
  dropDependency(targetDir, '@luckystack/presence');
  //? main.tsx: the router root used <LocationProvider/> (presence) as its layout
  //? element; swap it for a plain <Outlet/> so child routes still render.
  editScaffoldFile(targetDir, 'src/main.tsx', [
    [
      "import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';",
      "import { createBrowserRouter, RouterProvider, useParams, useSearchParams, Outlet } from 'react-router-dom';",
    ],
    ["import { LocationProvider } from '@luckystack/presence/client';\n", ''],
    ['element: <LocationProvider />,', 'element: <Outlet />,'],
  ]);
  //? TemplateProvider.tsx: drop the <SocketStatusIndicator/> (presence) and the
  //? now-orphaned socket-status + translator wiring it depended on.
  editScaffoldFile(targetDir, 'src/_components/templates/TemplateProvider.tsx', [
    ["import { SocketStatusIndicator } from '@luckystack/presence/client';\n", ''],
    [
      "import { useTheme, useSession, useTranslator } from '@luckystack/core/client';",
      "import { useTheme, useSession } from '@luckystack/core/client';",
    ],
    ["import { useSocketStatus } from 'src/_providers/socketStatusProvider';\n", ''],
    ['  const { socketStatus } = useSocketStatus();\n', ''],
    ['  const translate = useTranslator();\n', ''],
    [
      `      <SocketStatusIndicator
        status={socketStatus.self.status}
        reconnectAttempt={socketStatus.self.reconnectAttempt}
        label={translate({ key: 'template.socketStatus' })}
      />
`,
      '',
    ],
  ]);
};

//? The four README paragraphs that describe login as an INSTALLED feature of the
//? project. Each is removed (the OAuth/handlers/LoginForm ones) or replaced with a
//? neutral "add it later" pointer (the auth-pages one) when login is absent. Kept
//? as a shared constant so the prune is identical whether triggered at scaffold
//? time (authMode 'none') or — mirrored in @luckystack/cli — on `luckystack remove login`.
const LOGIN_DOC_EDITS: [string, string][] = [
  //? Pages section: keep ONE neutral discovery pointer (the package still exists).
  [
    "If you selected an **auth** mode (`credentials` / `credentials+oauth`), you'll also find the auth UI under `src/`: `login/page.tsx`, `register/page.tsx`, `reset-password/page.tsx`, and an account-management `settings/page.tsx`. Scaffolded with `auth: 'none'`? Add them later with `npx luckystack add login`.",
    "Want auth (login / register / account pages)? This project has none yet — add it anytime with `npx luckystack add login`.",
  ],
  //? API-routes section: remove the auth-handlers paragraph entirely (+ trailing blank).
  [
    "Selecting an **auth** mode also adds the auth-related API handlers — e.g. `logout_v1`, the `reset-password/_api/*` reset flow, and the `settings/_api/*` session / password / profile / account handlers. These ship alongside the auth pages above (and arrive together via `npx luckystack add login`).\n\n",
    '',
  ],
  //? Components section: remove the LoginForm paragraph entirely (+ trailing blank).
  [
    "If you selected an **auth** mode, `LoginForm.tsx` (the credentials + OAuth form used by `/login` and `/register`) is here too.\n\n",
    '',
  ],
  //? Configure section: remove the OAuth/adapter/notifications paragraph (+ trailing blank).
  [
    "With an **auth** mode selected, OAuth providers auto-wire from env at boot (set the vars in `.env.local`; no file needed), the user adapter self-wires via `defaultPrismaUserAdapter` (override with `registerUserAdapter()` in `luckystack/server/index.ts`), and `server/hooks/notifications.ts` wires the transactional new-sign-in / password-change emails.\n\n",
    '',
  ],
];

//? Strip login-as-installed prose from the scaffolded README (see LOGIN_DOC_EDITS).
//? editScaffoldFile throws on a token miss — desirable here: the template README is
//? controlled, so a miss means the doc drifted from this list and must be re-synced.
const pruneLoginDocs = (targetDir: string): void => {
  editScaffoldFile(targetDir, 'README.md', LOGIN_DOC_EDITS);
};

//? Remove all built-in auth UI/flows for the authMode:'none' scaffold.
const pruneAuthNone = (targetDir: string): void => {
  //? The framework's (anonymous) session plumbing stays — `session_v1` returns a
  //? null user, `SessionProvider`/`useSession` resolve to "no session", and the
  //? sockets still run — but the credentials/OAuth login + register + password-reset
  //? pages, the account-management settings page, the LoginForm, and the
  //? `functions/session` shim (which re-exported @luckystack/login) are all removed.
  //? The direct @luckystack/login dependency is dropped (framework packages still
  //? pull it transitively); no scaffold code imports it after this prune.
  dropDependency(targetDir, '@luckystack/login');
  for (const target of [
    'src/login',
    'src/register',
    'src/reset-password',
    'src/settings',
    'src/_components/LoginForm.tsx',
    //? The example logout handler calls `functions.session.deleteSession` — the
    //? `functions/session` shim is removed just below, so this handler can't
    //? compile (and a no-auth app has nothing to log out of). `session_v1` stays
    //? because it only echoes the (anonymous) session and never touches the shim.
    'src/_api/logout_v1.ts',
    'functions/session.ts',
    //? Auth/account transactional-email hooks (new-sign-in + password-change).
    //? They register a `postLogin` hook whose payload type ships with
    //? @luckystack/login — which we just dropped — and the password-change
    //? helper was only called by the (now-removed) settings page.
    'server/hooks/notifications.ts',
  ]) {
    removeScaffoldPath(targetDir, target);
  }

  //? Strip every README paragraph that describes login as an INSTALLED feature of
  //? this project (auth pages, auth API handlers, LoginForm, OAuth auto-wiring).
  //? A `auth: 'none'` scaffold has none of these — leaving the prose would be a
  //? doc lie. The ONLY surviving mention is a neutral "add it later" pointer (the
  //? @luckystack/login package still EXISTS as an option; that reference stays).
  pruneLoginDocs(targetDir);

  //? Server overlay registered the notification hooks + an example postLogin
  //? logger. Both reference login-only hook payloads; strip them so the
  //? overlay compiles without @luckystack/login (leave a minimal placeholder).
  editScaffoldFile(targetDir, 'luckystack/server/index.ts', [
    [
      `import { registerHook, resolveEnvKey } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads \`user.preferences\` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with \`{ ok: false, reason: 'no-sender' }\`.
registerNotificationHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (resolveEnvKey() !== 'production') {
    console.log(\`[hooks] login: user=\${userId}, provider=\${provider}, new=\${String(isNewUser)}\`);
  }
  return undefined;
});`,
      `//? authMode 'none': no auth hooks to register. Add your own framework-hook
//? registrations here (this overlay is auto-imported at boot, after every
//? other overlay file).
export {};`,
    ],
  ]);

  //? Root route '/': no login page to bounce to — land on the app's main surface.
  editScaffoldFile(targetDir, 'src/page.tsx', [
    [
      `import type { PageMiddleware } from "@luckystack/core/client";
import { loginPageUrl, loginRedirectUrl, type SessionLayout } from "config";

export const template = 'plain';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) =>
  session
    ? { success: false, redirect: loginRedirectUrl }
    : { success: false, redirect: loginPageUrl };`,
      `import type { PageMiddleware } from "@luckystack/core/client";

export const template = 'plain';

//? No auth: '/' lands on the app's main surface (the sample dashboard).
export const middleware: PageMiddleware = () => ({ success: false, redirect: '/dashboard' });`,
    ],
  ]);

  //? Dashboard: public (drop the logged-out → /login redirect guard).
  editScaffoldFile(targetDir, 'src/dashboard/page.tsx', [
    [
      `import { useTranslator } from '@luckystack/core/client';
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from '../../config';`,
      `import { useTranslator } from '@luckystack/core/client';`,
    ],
    [
      `export const template = 'plain' as const;

//? Per-page route guard. Logged-out visitors bounce to \`/login\`. Customize
//? the function body for role-checks (e.g. \`if (!session.admin) return;\`
//? returns \`undefined\` which sends the user back in browser history).
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

export default Dashboard;`,
      `export const template = 'plain' as const;

export default Dashboard;`,
    ],
  ]);

  //? Home shell: drop the settings + sign-out links (those routes no longer
  //? exist) and the now-unused translator wiring.
  editScaffoldFile(targetDir, 'src/_components/templates/Home.tsx', [
    [
      "import { Middleware, useSession, useTranslator } from '@luckystack/core/client';",
      "import { Middleware, useSession } from '@luckystack/core/client';",
    ],
    ['  const translate = useTranslator();\n', ''],
    [
      `        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-sm text-common hover:text-primary transition-colors">
            {translate({ key: 'home.settings' })}
          </Link>
          <Link to="/logout" className="text-sm text-common hover:text-primary transition-colors">
            {translate({ key: 'home.signOut' })}
          </Link>
        </div>
`,
      '',
    ],
  ]);

  //? config.ts: disable credentials + framework forgot-password (no auth flows).
  editScaffoldFile(targetDir, 'config.ts', [
    [
      `  auth: {
    //? forgot-password is a @luckystack/login feature: it ONLY works with
    //? @luckystack/login installed. 'framework' mode ALSO needs @luckystack/email
    //? installed + a sender registered in server.ts to deliver the reset mail.
    //? Set to 'disabled' or 'custom' to opt out.
    forgotPassword: 'framework',
    //? Email+password auth. Set \`false\` for an OAuth-only app — the login form
    //? hides the email/password fields and the credentials route rejects.
    credentials: true,
  },`,
      `  auth: {
    //? authMode 'none': no built-in auth UI/flows are scaffolded.
    forgotPassword: 'disabled',
    credentials: false,
  },`,
    ],
  ]);
};

//? Strip @luckystack/error-tracking when the consumer opted out. The only active
//? reference in the template is the `functions/sentry.ts` shim (which re-exports
//? the package as `functions.sentry.*`); every other mention is a comment or the
//? esbuild externals list (harmless when the package is absent). The framework's
//? auto-instrumentation degrades gracefully when the package isn't installed.
const pruneErrorTracking = (targetDir: string): void => {
  dropDependency(targetDir, '@luckystack/error-tracking');
  removeScaffoldPath(targetDir, 'functions/sentry.ts');
};

//? Fully wire @luckystack/secret-manager when opted IN: the dep is added by
//? injectOptionalDeps; here we uncomment the two enable-later blocks the template
//? ships (the `secretManager` slot in config.ts + the init block in server.ts).
//? It stays dormant until LUCKYSTACK_SECRET_MANAGER_URL is set — the init is
//? gated on `projectConfig.secretManager?.url` (empty by default) — so a fresh
//? scaffold still boots without an external secret server.
const wireSecretManager = (targetDir: string): void => {
  editScaffoldFile(targetDir, 'config.ts', [
    [
      `  // secretManager: {
  //   url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
  //   token: { fromFile: '.secret-manager-token' },
  // },`,
      `  secretManager: {
    url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
    token: { fromFile: '.secret-manager-token' },
    //? Which \`.env\` names are eligible for off-host resolution. The package's
    //? secure default (omitting this) resolves NOTHING — so the scaffold opts in
    //? to resolving every pointer-shaped (\`NAME=BASE_V<n>\`) value here, which is
    //? what "install secret-manager → it just works" expects. To restrict, replace
    //? \`() => true\` with an allowlist array of names, e.g. \`['OPENAI_KEY', 'DB_URL']\`.
    envNames: () => true,
  },`,
    ],
  ]);
  editScaffoldFile(targetDir, 'server/server.ts', [
    [
      `  // const projectConfig = (await import('../config')).default;
  // if (projectConfig.secretManager?.url) {
  //   const sm = await import('@luckystack/secret-manager');
  //   await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  // }`,
      `  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }`,
    ],
  ]);
  //? Same enable-later block in scripts/prismaWithSecrets.ts — so `prisma:*`
  //? resolves DATABASE_URL pointers before running prisma. Byte-identical to the
  //? server/server.ts block above (CLI `removeSecretManager` re-comments both).
  editScaffoldFile(targetDir, 'scripts/prismaWithSecrets.ts', [
    [
      `  // const projectConfig = (await import('../config')).default;
  // if (projectConfig.secretManager?.url) {
  //   const sm = await import('@luckystack/secret-manager');
  //   await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  // }`,
      `  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }`,
    ],
  ]);
};

//? Activate @luckystack/presence when opted IN (presence is KEPT, not pruned).
//? The full template ships the client mounts (<LocationProvider/> +
//? <SocketStatusIndicator/>) but the three gating flags default OFF, so without
//? this presence renders/emits nothing. Flip all three to `true` so an installed
//? presence is actually live: `socketActivityBroadcaster` (per-room activity),
//? `socketStatusIndicator` (the status badge), `locationProviderEnabled`
//? (client → server location syncing). Tokens match the template config.ts lines;
//? `editScaffoldFile` throws on a miss so template drift fails loud.
const wirePresence = (targetDir: string): void => {
  editScaffoldFile(targetDir, 'config.ts', [
    ['socketActivityBroadcaster: false,', 'socketActivityBroadcaster: true,'],
    ['socketStatusIndicator: false,', 'socketStatusIndicator: true,'],
    ['locationProviderEnabled: false,', 'locationProviderEnabled: true,'],
  ]);
};

//? Wire @luckystack/router (opt-in): a multi-instance load-balancer that runs as
//? a SEPARATE process (`npm run router`) and reads the project's deploy.config.ts +
//? services.config.ts for its routing topology. Those files (and their server.ts
//? side-effect imports) ship in the template and are KEPT here because router was
//? chosen — `pruneRouter` only strips them when router is OFF. So this just adds the
//? dependency + the run script. Env (ROUTER_PORT / LUCKYSTACK_ENV) is documented in
//? docs/luckystack/ARCHITECTURE_MULTI_INSTANCE.md. A single-instance app never runs
//? it — it's here so scaling out later is `npm run router`, no rewiring.
const wireRouter = (targetDir: string, luckystackVersion: string): void => {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg: { name?: string; dependencies?: Record<string, string>; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as typeof pkg;
    if (typeof pkg.name !== 'string') throw new Error('package.json missing name field');
  } catch {
    console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping router wiring.`);
    return;
  }
  pkg.dependencies = { ...pkg.dependencies, '@luckystack/router': `^${luckystackVersion}` };
  pkg.scripts = { ...pkg.scripts, router: 'luckystack-router' };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

//? Wire @luckystack/mcp (the project graph MCP server) when AI dev-context is on:
//? add it as a devDep + register it in `.mcp.json` so an AI client (Claude Code)
//? can query the dependency graph (blast_radius / who_imports / who_calls /
//? god_nodes) over THIS project. Reads docs/ai-graph.json (kept fresh by the
//? pre-commit hook). Additive — merges into any existing .mcp.json.
const wireGraphMcp = (targetDir: string, luckystackVersion: string): void => {
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string; devDependencies?: Record<string, string> };
      if (typeof pkg.name !== 'string') throw new Error('package.json missing name field');
      pkg.devDependencies = { ...pkg.devDependencies, '@luckystack/mcp': `^${luckystackVersion}` };
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    } catch {
      console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping @luckystack/mcp dep.`);
    }
  }
  mergeJsonFile(path.join(targetDir, '.mcp.json'), (data) => {
    const servers = (data.mcpServers ??= {}) as Record<string, unknown>;
    servers.luckystack ??= { type: 'stdio', command: 'npx', args: [`@luckystack/mcp@^${luckystackVersion}`] };
  });
};

//? Remove the docs-ui API explorer page when docs-ui was NOT chosen. The template
//? ships `src/docs/page.tsx` (the React API explorer); it's only meaningful with
//? @luckystack/docs-ui, so a lean (docs-ui OFF) scaffold drops it. The dep itself
//? is opt-IN via injectOptionalDeps, so there's nothing else to remove here. The
//? generated `apiDocs.generated.json` is gitignored (never in the template).
const pruneDocsUi = (targetDir: string): void => {
  removeScaffoldPath(targetDir, 'src/docs');
};

//? Remove the @luckystack/router topology when router was NOT chosen. The template
//? ships services.config.ts + deploy.config.ts + server/config/presetLoader.ts (so a
//? --router scaffold keeps them AND the cli's assetParity test has a counterpart);
//? a base / single-instance scaffold drops the three files + the two side-effect
//? imports in server/server.ts. `generateServerRequests` then falls back to a single
//? `default` bundle (presetLoader is not needed). `npx luckystack add router` restores
//? all of this post-install (and `remove router` re-prunes it). Mirrors the
//? prunePresence / pruneDocsUi opt-OUT pattern.
const pruneRouter = (targetDir: string): void => {
  removeScaffoldPath(targetDir, 'services.config.ts');
  removeScaffoldPath(targetDir, 'deploy.config.ts');
  removeScaffoldPath(targetDir, 'server/config/presetLoader.ts');
  editScaffoldFile(targetDir, 'server/server.ts', [
    ["import '../deploy.config';\nimport '../services.config';\n", ''],
  ]);
};

//? The `functions/db.ts` shim shipped under orm: 'none' — the consumer exports
//? THEIR client here and it becomes `functions.db.*` in every handler (no
//? casts, no Prisma types involved).
const ORM_NONE_DB_SHIM = `//? orm: 'none' — this project ships WITHOUT Prisma. Export your own database
//? client from this file; whatever you export becomes \`functions.db.*\` inside
//? every API + sync handler (function-injection, see
//? docs/luckystack/ARCHITECTURE_FUNCTION_INJECTION.md).
//?
//? Example (drizzle + postgres):
//?   import { drizzle } from 'drizzle-orm/node-postgres';
//?   export const db = drizzle(process.env.DATABASE_URL ?? '');
//?
//? Until you export something, any \`functions.db\` access is simply an empty
//? object — and framework-level DB access (unused with auth off) throws an
//? actionable error pointing at luckystack/core/clients.ts.

export {};
`;

//? The `luckystack/core/clients.ts` overlay shipped under orm: 'none'.
const ORM_NONE_CLIENTS_STUB = `//? Data-layer registration hooks (orm: 'none' — this project ships WITHOUT
//? Prisma). Two optional registrations belong here:
//?
//? 1) /readyz database probe — without it the readiness check reports the
//?    database as 'skipped' (the project can still go ready):
//?
//?      import { registerDbHealthCheck } from '@luckystack/core';
//?      registerDbHealthCheck(async () => { /* await yourClient.ping() */ return true; });
//?
//? 2) Redis overrides (unchanged from a normal scaffold) — Redis stays
//?    REQUIRED: sessions, rate-limiting, and one-time tokens run on it:
//?
//?      import { registerRedisClient } from '@luckystack/core';
//?      import Redis from 'ioredis';
//?      registerRedisClient(new Redis({ host: '...', tls: {} }));
//?
//? Your handler-facing database client lives in functions/db.ts (export it
//? there and it becomes \`functions.db.*\`). If you later add Prisma after all:
//? npm i @prisma/client prisma, restore prisma/schema.prisma, and register the
//? client here via registerPrismaClient(...).

export {};
`;

//? The exact config.ts import line the template ships (and stripPrismaSurface
//? swaps out). Exported so the CLI's ORM switcher can pin the SAME token —
//? the switchOrm parity test guards against drift.
export const PRISMA_USER_TYPE_IMPORT = "import type { User } from '@prisma/client';";

//? A local stand-in for the Prisma-generated `User` type that config.ts's
//? `SessionLayout` derives from. Mirrors the template schema.prisma User model
//? field-for-field (the shipped components read `theme`/`avatar`/`language`,
//? so a minimal stub breaks the consumer tsc) — the consumer reshapes it
//? freely; it only feeds their own session typing. Exported for the CLI parity test.
export const ORM_NONE_CONFIG_USER_TYPE = `//? orm: 'none' — no Prisma-generated User type; shape your own session
//? source type here (SessionLayout below derives from it). This mirrors the
//? default template's User model — adjust it to YOUR data layer's user shape.
type User = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  password: string | null;
  provider: 'credentials' | 'google' | 'github' | 'discord' | 'facebook' | 'microsoft';
  name: string | null;
  avatar: string;
  avatarFallback: string;
  admin: boolean;
  language: 'en' | 'nl' | 'de' | 'fr';
  theme: 'light' | 'dark';
};`;

//? Generic scaffold package.json mutation (read → mutate → pretty-write).
//? Shared by the per-ORM wirers below.
interface ScaffoldPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}
const mutateScaffoldPackageJson = (
  targetDir: string,
  mutate: (pkg: ScaffoldPackageJson) => void,
): void => {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg: ScaffoldPackageJson;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as ScaffoldPackageJson;
  } catch {
    console.warn(`[create-luckystack-app] Could not parse ${pkgPath} — skipping package.json ORM edits.`);
    return;
  }
  mutate(pkg);
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

//? Common to every non-prisma orm (ADR 0020): remove the scaffold's Prisma
//? surface. The runtime seam lives in @luckystack/core (lazy '@prisma/client'
//? load + an actionable no-client error) — this only removes files/deps/
//? scripts and swaps the Prisma User type for a local placeholder.
const stripPrismaSurface = (targetDir: string): void => {
  removeScaffoldPath(targetDir, 'prisma');
  removeScaffoldPath(targetDir, 'scripts/prismaWithSecrets.ts');
  editScaffoldFile(targetDir, 'config.ts', [
    [PRISMA_USER_TYPE_IMPORT, ORM_NONE_CONFIG_USER_TYPE],
  ]);
  mutateScaffoldPackageJson(targetDir, (pkg) => {
    if (pkg.dependencies) {
      const { '@prisma/client': _client, ...dependencies } = pkg.dependencies;
      pkg.dependencies = dependencies;
    }
    if (pkg.devDependencies) {
      const { prisma: _prismaCli, ...devDependencies } = pkg.devDependencies;
      pkg.devDependencies = devDependencies;
    }
    if (pkg.scripts) {
      const scripts = { ...pkg.scripts };
      delete scripts['prisma:generate'];
      delete scripts['prisma:db:push'];
      delete scripts['prisma:migrate:dev'];
      pkg.scripts = scripts;
    }
  });
};

//? ─────────────── drizzle (TypeScript-first, SQL-only) ───────────────
//? Starter shape: server/db/schema.ts (inside the tsconfig.server include
//? tree — no tsconfig edits needed) + root drizzle.config.ts (read by
//? drizzle-kit itself) + functions/db.ts exporting the live client.

//? Exported for CLI parity tests (the ORM switcher keeps name-only copies).
export const DRIZZLE_DRIVER_DEPS: Record<
  Exclude<DbProvider, 'mongodb'>,
  { deps: Record<string, string>; devDeps: Record<string, string> }
> = {
  postgresql: { deps: { pg: '^8.16.0' }, devDeps: { '@types/pg': '^8.15.0' } },
  mysql: { deps: { mysql2: '^3.15.0' }, devDeps: {} },
  sqlite: { deps: { 'better-sqlite3': '^12.4.0' }, devDeps: { '@types/better-sqlite3': '^7.6.13' } },
};

const drizzleSchemaFor = (dbProvider: DbProvider): string => {
  const header = `//? Drizzle schema — the single source your tables + generated types come
//? from. Extend this file, then run \`npm run db:push\` (prototyping) or
//? \`npm run db:generate\` + \`npm run db:migrate\` (versioned migrations).
//? Docs: https://orm.drizzle.team/docs/sql-schema-declaration
`;
  if (dbProvider === 'mysql') {
    return `${header}import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const items = mysqlTable('items', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;
  }
  if (dbProvider === 'sqlite') {
    return `${header}import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
});
`;
  }
  return `${header}import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;
};

const drizzleKitConfigFor = (dbProvider: DbProvider, databaseUrl: string): string => {
  const dialect = dbProvider === 'postgresql' ? 'postgresql' : (dbProvider === 'mysql' ? 'mysql' : 'sqlite');
  const urlExpression = dbProvider === 'sqlite'
    ? `(process.env.DATABASE_URL ?? '${databaseUrl}').replace(/^file:/, '')`
    : `process.env.DATABASE_URL ?? '${databaseUrl}'`;
  return `//? drizzle-kit config (schema push/generate/migrate/studio). drizzle-kit
//? does NOT load .env.local by itself — the fallback below keeps the dev
//? default working; export DATABASE_URL (or load your env) for anything else.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: '${dialect}',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: ${urlExpression},
  },
});
`;
};

const drizzleDbShimFor = (dbProvider: DbProvider, databaseUrl: string): string => {
  const header = `//? Drizzle client shim. Whatever this file exports becomes \`functions.db.*\`
//? inside every API + sync handler (function-injection — see
//? docs/luckystack/ARCHITECTURE_FUNCTION_INJECTION.md). The schema lives in
//? server/db/schema.ts.
`;
  if (dbProvider === 'mysql') {
    return `${header}import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from '../server/db/schema';

const pool = mysql.createPool(process.env.DATABASE_URL ?? '${databaseUrl}');

export const db = drizzle(pool, { schema, mode: 'default' });
export { schema };
`;
  }
  if (dbProvider === 'sqlite') {
    return `${header}import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../server/db/schema';

const file = (process.env.DATABASE_URL ?? '${databaseUrl}').replace(/^file:/, '');

export const db = drizzle(new Database(file), { schema });
export { schema };
`;
  }
  return `${header}import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../server/db/schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? '${databaseUrl}' });

export const db = drizzle(pool, { schema });
export { schema };
`;
};

const DRIZZLE_CLIENTS_STUB = `//? Data-layer registration hooks (orm: 'drizzle'). Your handler-facing client
//? lives in functions/db.ts (\`functions.db.db\` in handlers). Two optional
//? registrations belong here:
//?
//? 1) /readyz database probe — without it the readiness check reports the
//?    database as 'skipped' (the project can still go ready). Example
//?    (postgres/mysql; for better-sqlite3 use \`db.run(...)\`):
//?
//?      import { registerDbHealthCheck } from '@luckystack/core';
//?      import { sql } from 'drizzle-orm';
//?      import { db } from '../../functions/db';
//?      registerDbHealthCheck(async () => { await db.execute(sql\`select 1\`); return true; });
//?
//? 2) Redis overrides (unchanged from a normal scaffold) — Redis stays
//?    REQUIRED: sessions, rate-limiting, and one-time tokens run on it.
//?
//? Auth was scaffolded OFF: the built-in login UserAdapter is Prisma-backed.
//? To enable auth on drizzle, install @luckystack/login and register a custom
//? UserAdapter here (node_modules/@luckystack/login/docs/user-adapter.md has a
//? complete drizzle example).

export {};
`;

//? ─────────────── mikro-orm (TypeScript-first, incl. MongoDB) ───────────────
//? Starter shape uses EntitySchema (NOT decorators) so the template needs no
//? experimentalDecorators/reflect-metadata changes.

//? Exported for CLI parity tests (the ORM switcher keeps name-only copies).
export const MIKRO_DRIVER_PACKAGES: Record<DbProvider, string> = {
  postgresql: '@mikro-orm/postgresql',
  mysql: '@mikro-orm/mysql',
  sqlite: '@mikro-orm/better-sqlite',
  mongodb: '@mikro-orm/mongodb',
};

const mikroEntitiesFor = (dbProvider: DbProvider): string => {
  const header = `//? MikroORM entities via EntitySchema (no decorators needed). Extend this
//? file and run \`npm run db:schema:update\` to sync the database.
//? Docs: https://mikro-orm.io/docs/entity-schema
`;
  if (dbProvider === 'mongodb') {
    return `${header}import { EntitySchema } from '@mikro-orm/core';
import type { ObjectId } from '@mikro-orm/mongodb';

export interface Item {
  _id: ObjectId;
  id: string;
  name: string;
  createdAt: Date;
}

export const ItemSchema = new EntitySchema<Item>({
  name: 'Item',
  properties: {
    _id: { type: 'ObjectId', primary: true },
    id: { type: 'string', serializedPrimaryKey: true },
    name: { type: 'string' },
    createdAt: { type: 'Date', onCreate: () => new Date() },
  },
});
`;
  }
  return `${header}import { EntitySchema } from '@mikro-orm/core';

export interface Item {
  id: number;
  name: string;
  createdAt: Date;
}

export const ItemSchema = new EntitySchema<Item>({
  name: 'Item',
  properties: {
    id: { type: 'number', primary: true, autoincrement: true },
    name: { type: 'string' },
    createdAt: { type: 'Date', onCreate: () => new Date() },
  },
});
`;
};

const mikroConfigFor = (dbProvider: DbProvider, databaseUrl: string): string => {
  const driverPackage = MIKRO_DRIVER_PACKAGES[dbProvider];
  const connection = dbProvider === 'sqlite'
    ? `dbName: (process.env.DATABASE_URL ?? '${databaseUrl}').replace(/^file:/, ''),`
    : `clientUrl: process.env.DATABASE_URL ?? '${databaseUrl}',`;
  return `//? MikroORM config — consumed by functions/db.ts AND the mikro-orm CLI
//? (\`npm run db:schema:update\`; the CLI finds this file via the "mikro-orm"
//? entry in package.json). Entities are listed EXPLICITLY (EntitySchema), so
//? no ts-morph discovery or decorator metadata is needed.
import { defineConfig } from '${driverPackage}';
import { ItemSchema } from './entities';

export default defineConfig({
  ${connection}
  entities: [ItemSchema],
});
`;
};

const MIKRO_DB_SHIM = `//? MikroORM shim. Whatever this file exports becomes \`functions.db.*\` inside
//? every API + sync handler (function-injection — see
//? docs/luckystack/ARCHITECTURE_FUNCTION_INJECTION.md).
//?
//? MikroORM initializes ASYNCHRONOUSLY — use \`getEm()\` inside handlers:
//?   const em = await functions.db.getEm();
//?   const items = await em.find('Item', {});
import { MikroORM, type EntityManager } from '@mikro-orm/core';
import config from '../server/db/mikro-orm.config';

let ormPromise: Promise<MikroORM> | undefined;

export const getOrm = (): Promise<MikroORM> => {
  ormPromise ??= MikroORM.init(config);
  return ormPromise;
};

//? Always fork the global EntityManager per unit of work (request/job) —
//? MikroORM's identity map is not safe to share across concurrent handlers.
export const getEm = async (): Promise<EntityManager> => (await getOrm()).em.fork();
`;

const MIKRO_CLIENTS_STUB = `//? Data-layer registration hooks (orm: 'mikro-orm'). Your handler-facing
//? helpers live in functions/db.ts (\`functions.db.getEm()\` in handlers).
//? Two optional registrations belong here:
//?
//? 1) /readyz database probe — without it the readiness check reports the
//?    database as 'skipped' (the project can still go ready):
//?
//?      import { registerDbHealthCheck } from '@luckystack/core';
//?      import { getOrm } from '../../functions/db';
//?      registerDbHealthCheck(async () => (await getOrm()).isConnected());
//?
//? 2) Redis overrides (unchanged from a normal scaffold) — Redis stays
//?    REQUIRED: sessions, rate-limiting, and one-time tokens run on it.
//?
//? Auth was scaffolded OFF: the built-in login UserAdapter is Prisma-backed.
//? To enable auth on mikro-orm, install @luckystack/login and register a
//? custom UserAdapter here (implement the small UserAdapter interface with an
//? EntityManager — node_modules/@luckystack/login/docs/user-adapter.md).

export {};
`;

//? Apply the chosen non-prisma data layer (ADR 0020): strip Prisma, then wire
//? the ORM-specific starter files + dependencies + scripts. `orm: 'prisma'`
//? never reaches this function.
const applyOrmChoice = (targetDir: string, choices: ScaffoldChoices, databaseUrl: string): void => {
  stripPrismaSurface(targetDir);

  if (choices.orm === 'none') {
    fs.writeFileSync(path.join(targetDir, 'functions', 'db.ts'), ORM_NONE_DB_SHIM);
    fs.writeFileSync(path.join(targetDir, 'luckystack', 'core', 'clients.ts'), ORM_NONE_CLIENTS_STUB);
    return;
  }

  const dbDir = path.join(targetDir, 'server', 'db');
  fs.mkdirSync(dbDir, { recursive: true });

  if (choices.orm === 'drizzle') {
    fs.writeFileSync(path.join(dbDir, 'schema.ts'), drizzleSchemaFor(choices.dbProvider));
    fs.writeFileSync(path.join(targetDir, 'drizzle.config.ts'), drizzleKitConfigFor(choices.dbProvider, databaseUrl));
    fs.writeFileSync(path.join(targetDir, 'functions', 'db.ts'), drizzleDbShimFor(choices.dbProvider, databaseUrl));
    fs.writeFileSync(path.join(targetDir, 'luckystack', 'core', 'clients.ts'), DRIZZLE_CLIENTS_STUB);
    //? mongodb is unreachable here (rejected/coerced during choice resolution).
    const sqlDb = choices.dbProvider === 'mongodb' ? 'postgresql' : choices.dbProvider;
    const driver = DRIZZLE_DRIVER_DEPS[sqlDb];
    mutateScaffoldPackageJson(targetDir, (pkg) => {
      pkg.dependencies = { ...pkg.dependencies, 'drizzle-orm': '^0.44.0', ...driver.deps };
      pkg.devDependencies = { ...pkg.devDependencies, 'drizzle-kit': '^0.31.0', ...driver.devDeps };
      pkg.scripts = {
        ...pkg.scripts,
        'db:generate': 'drizzle-kit generate',
        'db:migrate': 'drizzle-kit migrate',
        'db:push': 'drizzle-kit push',
        'db:studio': 'drizzle-kit studio',
      };
    });
    return;
  }

  //? mikro-orm
  fs.writeFileSync(path.join(dbDir, 'entities.ts'), mikroEntitiesFor(choices.dbProvider));
  fs.writeFileSync(path.join(dbDir, 'mikro-orm.config.ts'), mikroConfigFor(choices.dbProvider, databaseUrl));
  fs.writeFileSync(path.join(targetDir, 'functions', 'db.ts'), MIKRO_DB_SHIM);
  fs.writeFileSync(path.join(targetDir, 'luckystack', 'core', 'clients.ts'), MIKRO_CLIENTS_STUB);
  const driverPackage = MIKRO_DRIVER_PACKAGES[choices.dbProvider];
  mutateScaffoldPackageJson(targetDir, (pkg) => {
    pkg.dependencies = {
      ...pkg.dependencies,
      '@mikro-orm/core': '^6.6.0',
      [driverPackage]: '^6.6.0',
    };
    pkg.devDependencies = { ...pkg.devDependencies, '@mikro-orm/cli': '^6.6.0' };
    pkg.scripts = { ...pkg.scripts, 'db:schema:update': 'mikro-orm schema:update --run' };
    //? CLI config discovery — points `npm run db:schema:update` at the config.
    pkg['mikro-orm'] = { configPaths: ['./server/db/mikro-orm.config.ts'] };
  });
};

//? Remove OPT-OUT packages from a freshly-copied scaffold. Bounded packages:
//? presence + error-tracking (drop dep + the few files/lines that referenced them),
//? and docs-ui's explorer page. login/sync are more deeply woven (login is a whole
//? auth surface; sync's `initSyncRequest` is called from the presence/activity path
//? in socketInitializer) — see docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md §6.
//? (secret-manager is opt-IN and only uncomments config blocks, nothing to prune.)
const pruneOptionalPackages = (targetDir: string, choices: ScaffoldChoices): void => {
  if (!choices.presence) prunePresence(targetDir);
  if (!choices.errorTracking) pruneErrorTracking(targetDir);
  if (!choices.docsUi) pruneDocsUi(targetDir);
  if (!choices.router) pruneRouter(targetDir);
  if (choices.authMode === 'none') pruneAuthNone(targetDir);
  //? The non-prisma ORM wiring (applyOrmChoice) runs from main() AFTER this —
  //? it needs the rendered DATABASE_URL default, which lives in the template
  //? vars main() already computed.
};

//? Static lookup tables — moved to module scope so they aren't rebuilt on
//? every `main()` invocation (by-call recreation was the original pattern).
//? DATABASE_URL_BY_PROVIDER stays local to buildTemplateVars() because it embeds `slug`.
const USER_ID_ATTRS_BY_PROVIDER: Readonly<Record<string, string>> = {
  mongodb: '@id @default(auto()) @map("_id") @db.ObjectId',
  postgresql: '@id @default(cuid())',
  mysql: '@id @default(cuid())',
  sqlite: '@id @default(cuid())',
};

//? OAuth provider → its canonical authorization-endpoint origin. These are
//? added to EXTERNAL_ORIGINS so the framework's origin gate passes the callback.
const OAUTH_PROVIDER_ORIGINS: Readonly<Record<string, string>> = {
  google: 'https://accounts.google.com',
  github: 'https://github.com',
  facebook: 'https://www.facebook.com',
  discord: 'https://discord.com',
  microsoft: 'https://login.microsoftonline.com',
};

//? Validate CLI args: project name presence, slug derivability, and target-directory
//? safety. Calls process.exit on any violation so callers need no error handling.
const validateArgsOrExit = (args: CliArgs): { slug: string; targetDir: string } => {
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

  //? Build the directory from the sanitized `slug` (never the raw
  //? `args.projectName`) and assert the resolved path stays inside the
  //? current working directory, so `../` segments can't escape the project
  //? root and write template files to arbitrary locations.
  const cwd = process.cwd();
  const targetDir = path.resolve(cwd, slug);
  const relativeTarget = path.relative(cwd, targetDir);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    console.error(`Invalid project name: "${args.projectName}". The target directory must stay within the current directory.`);
    process.exit(1);
  }

  if (fs.existsSync(targetDir)) {
    console.error(`Target directory already exists: ${targetDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`Template directory missing: ${TEMPLATE_DIR}`);
    console.error('This is a packaging bug — the template/ folder should ship with the package.');
    process.exit(1);
  }

  return { slug, targetDir };
};

//? Build the {{TOKEN}} substitution map for the template tree. DATABASE_URL
//? embeds `slug`, so it must be built per-run (not a module constant).
const buildTemplateVars = (
  slug: string,
  args: CliArgs,
  choices: ScaffoldChoices,
  luckystackVersion: string,
): Record<string, string> => {
  //? Prisma + MongoDB REQUIRES a replica set (it uses transactions); a bare
  //? `mongodb://host/db` URL fails at runtime. `replicaSet=rs0` +
  //? `directConnection=true` is the canonical single-node dev replica-set shape.
  const databaseUrlByProvider: Record<string, string> = {
    mongodb: `mongodb://localhost:27017/${slug}?replicaSet=rs0&directConnection=true`,
    postgresql: `postgresql://user:password@localhost:5432/${slug}`,
    mysql: `mysql://user:password@localhost:3306/${slug}`,
    sqlite: 'file:./dev.db',
  };

  const externalOrigins = choices.oauthProviders
    .flatMap((provider) => {
      const origin = OAUTH_PROVIDER_ORIGINS[provider];
      return origin ? [origin] : [];
    })
    .join(',');

  //? Only vars that are actually used as {{TOKEN}} in the template tree are
  //? listed here. If you add a new placeholder to a template file, add it here
  //? first — unused entries are silently skipped by replacePlaceholders.
  return {
    PROJECT_NAME: slug,
    PROJECT_TITLE: titleCase(args.projectName),
    LUCKYSTACK_VERSION: luckystackVersion,
    DB_PROVIDER: choices.dbProvider,
    //? MongoDB's Prisma connector does NOT support `migrate dev` — it needs
    //? `db push`. Keep this in step with `printNextSteps`' prismaCmd so the
    //? README's first DB command matches the chosen provider.
    PRISMA_INIT_CMD: ((): string => {
      if (choices.orm === 'none') return '# (orm: none — wire your own data layer; see functions/db.ts + luckystack/core/clients.ts)';
      if (choices.orm === 'drizzle') return 'npm run db:push';
      if (choices.orm === 'mikro-orm') return 'npm run db:schema:update';
      return choices.dbProvider === 'mongodb' ? 'npm run prisma:db:push' : 'npm run prisma:migrate:dev';
    })(),
    USER_ID_ATTRS: USER_ID_ATTRS_BY_PROVIDER[choices.dbProvider] ?? '@id @default(cuid())',
    DATABASE_URL: databaseUrlByProvider[choices.dbProvider] ?? `postgresql://user:password@localhost:5432/${slug}`,
    OAUTH_ENV_VARS: buildOAuthEnvVars(choices.oauthProviders, choices.authMode),
    EXTERNAL_ORIGINS: externalOrigins,
    EMAIL_ENV_VARS: buildEmailEnvVars(choices.emailProvider),
    MONITORING_ENV_VARS: buildMonitoringEnvVars(choices.monitoringProvider),
  };
};

//? Copy the framework AI docs (CLAUDE.md, docs/, skills/, .claude/commands/,
//? branch-logs/README.md) into the scaffold, install the pre-commit AI-index hook,
//? and wire the @luckystack/mcp server into .mcp.json. No-op when `aiInstructions`
//? is off — callers gate on that before invoking.
const copyAiDocs = (
  targetDir: string,
  vars: Record<string, string>,
  luckystackVersion: string,
): void => {
  //? Source of the framework AI docs. In a published install they ship INSIDE
  //? this package under `framework-docs/` (bundled at build time by
  //? scripts/bundleFrameworkDocs.mjs) — the repo root is NOT in the tarball, so
  //? without this bundle the copy silently no-ops. In the monorepo (no bundle)
  //? we fall back to the repo-root originals so `scaffold:test` keeps working.
  //? The bundle flattens the two nested/dot sources (.claude/commands,
  //? branch-logs/README.md) to non-dot names so npm reliably ships them.
  const bundledDir = path.resolve(__dirname, '..', 'framework-docs');
  const fromBundle = fs.existsSync(bundledDir);
  const base = fromBundle ? bundledDir : path.resolve(__dirname, '..', '..', '..');

  //? Only branch-logs/README.md is copied (not the framework's own log
  //? entries) — the consumer's first session initializes their own log file.
  const docsCopies: [string, string, boolean][] = [
    // [source, dest, isDirectory]
    [path.join(base, 'CLAUDE.md'),                                                 path.join(targetDir, 'CLAUDE.md'),               false],
    [path.join(base, 'docs'),                                                      path.join(targetDir, 'docs', 'luckystack'),      true],
    [path.join(base, 'skills'),                                                    path.join(targetDir, 'skills'),                  true],
    [fromBundle ? path.join(base, 'claude-commands') : path.join(base, '.claude', 'commands'), path.join(targetDir, '.claude', 'commands'), true],
    [fromBundle ? path.join(base, 'branch-logs-README.md') : path.join(base, 'branch-logs', 'README.md'), path.join(targetDir, 'branch-logs', 'README.md'), false],
  ];

  let copiedCount = 0;
  for (const [src, dst, isDir] of docsCopies) {
    if (!fs.existsSync(src)) continue;
    if (isDir) {
      //? SCAF-N3 — docs/ are framework documentation that must be copied
      //? verbatim: passing `vars` would silently rewrite {{…}} tokens used
      //? as documentation examples (e.g. in ARCHITECTURE_*.md) into concrete
      //? project-specific values in the consumer's docs/luckystack/ tree.
      const treeVars = src === path.join(base, 'docs') ? {} : vars;
      copyTree(src, dst, treeVars);
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

  //? Wire the @luckystack/mcp server into .mcp.json so the consumer's Claude
  //? Code can QUERY the committed AI context (decisions, dependency graph,
  //? routes, runbooks, capabilities) instead of loading whole files. Run via
  //? npx — no app dependency. Additive (mergeJsonFile + ??=), so it coexists
  //? as a SEPARATE entry alongside the playwright/chrome-devtools browser MCP
  //? servers that wireAiBrowserTooling adds (they are not merged into one).
  mergeJsonFile(path.join(targetDir, '.mcp.json'), (data) => {
    const servers = (data.mcpServers ??= {}) as Record<string, unknown>;
    //? Pin to a minor range matching the scaffold's own @luckystack/* version
    //? so the MCP server speaks the same graph schema as the installed packages.
    servers.luckystack ??= { type: 'stdio', command: 'npx', args: [`@luckystack/mcp@^${luckystackVersion}`] };
  });

  if (copiedCount > 0) {
    console.log(`Framework AI documentation copied (${copiedCount} source(s) merged into target) + pre-commit AI-index hook + @luckystack/mcp server installed.`);
  }
};

//? Print the post-scaffold summary and next-step instructions.
const printNextSteps = (choices: ScaffoldChoices, slug: string): void => {
  const dbInitCmds: Record<OrmProvider, string> = {
    prisma: choices.dbProvider === 'mongodb'
      ? 'npm run prisma:db:push           # initializes the Mongo schema'
      : 'npm run prisma:migrate:dev       # creates the User table + initial migration',
    drizzle: 'npm run db:push                  # pushes server/db/schema.ts to the database',
    'mikro-orm': 'npm run db:schema:update         # syncs server/db/entities.ts to the database',
    none: '# no ORM scaffolded — wire your own data layer (see checklist below)',
  };
  const prismaCmd = dbInitCmds[choices.orm];
  const ormChecklists: Record<OrmProvider, string> = {
    prisma: '',
    drizzle: `
orm: drizzle — starter checklist:
  1. server/db/schema.ts    your tables (drizzle-kit reads it via drizzle.config.ts)
  2. functions/db.ts        exports the live client (functions.db.db in handlers)
  3. .env.local             set DATABASE_URL for your ${choices.dbProvider} instance
  4. luckystack/core/clients.ts   optional: registerDbHealthCheck(...) so /readyz probes your DB
  5. Auth is OFF            the built-in UserAdapter is Prisma-backed; a custom drizzle
                            UserAdapter re-enables it (see @luckystack/login docs/user-adapter.md)
`,
    'mikro-orm': `
orm: mikro-orm — starter checklist:
  1. server/db/entities.ts  your EntitySchema definitions (no decorators needed)
  2. functions/db.ts        exports getOrm()/getEm() (await functions.db.getEm() in handlers)
  3. .env.local             set DATABASE_URL for your ${choices.dbProvider} instance
  4. luckystack/core/clients.ts   optional: registerDbHealthCheck(...) so /readyz probes your DB
  5. Auth is OFF            the built-in UserAdapter is Prisma-backed; a custom mikro-orm
                            UserAdapter re-enables it (see @luckystack/login docs/user-adapter.md)
`,
    none: `
orm: none — bring-your-own data layer checklist:
  1. functions/db.ts        export your database client (becomes functions.db.* in handlers)
  2. luckystack/core/clients.ts   optional: registerDbHealthCheck(...) so /readyz probes your DB
  3. .env.local             set your own connection string (DATABASE_URL is just a suggestion)
  4. Redis stays REQUIRED   sessions / rate-limiting / tokens run on Redis, not the ORM
  5. Want auth later?       install Prisma (or register a custom UserAdapter) first —
                            the built-in login UserAdapter is Prisma-backed.
`,
  };
  const ormNoneChecklist = ormChecklists[choices.orm];
  console.log(`
Done — scaffold complete.

Choices:
  orm:         ${choices.orm}
  database:    ${choices.orm === 'none' ? '(none — bring your own)' : choices.dbProvider}${choices.orm === 'drizzle' || choices.orm === 'mikro-orm' ? ' (starter in server/db/)' : ''}
  auth:        ${choices.authMode}${choices.oauthProviders.length > 0 ? ' (' + choices.oauthProviders.join(', ') + ')' : ''}
  email:       ${choices.emailProvider}
  monitoring:  ${choices.monitoringProvider}
  presence:    ${choices.presence ? 'installed' : 'skipped'}
  error-track: ${choices.errorTracking ? 'installed' : 'skipped'}
  docs-ui:     ${choices.docsUi ? 'installed' : 'skipped'}
  secret-mgr:  ${choices.secretManager ? 'installed' : 'skipped'}
  router:      ${choices.router ? 'installed' : 'skipped'}
  ai-docs:     ${choices.aiInstructions ? 'included (+ pre-commit AI-index hook)' : 'skipped'}
  ai-browser:  ${choices.aiBrowserTooling}

Next steps:
  cd ${slug}
  cp .env_template .env
  cp .env.local_template .env.local   # fill in DATABASE_URL, etc.
  ${prismaCmd}
  npm run server                       # terminal 1 — backend (HTTP + Socket.io)
  npm run client                       # terminal 2 — frontend (Vite, opens http://localhost:5173)
${ormNoneChecklist}
Docs:
  https://github.com/ItsLucky23/LuckyStack-v2#readme
`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const { slug, targetDir } = validateArgsOrExit(args);

  //? Choice resolution. Every wizard option also has a CLI flag (CFG-01):
  //?   - interactive (`--prompt`, default): flags PRE-FILL the matching wizard
  //?     steps (which are then skipped) and the user is only asked for the rest;
  //?   - `--no-prompt`: typed flag values layered over DEFAULT_CHOICES, no prompts.
  const choices: ScaffoldChoices = args.prompt
    ? await runPrompts(buildPresetAnswers(args))
    : buildNoPromptChoices(args);

  const luckystackVersion = readSelfVersion();
  const vars = buildTemplateVars(slug, args, choices, luckystackVersion);

  //? Track that THIS run created targetDir so a partial failure can roll back
  //? cleanly. The existsSync guard above ensures it didn't exist beforehand.
  //? The flag is set just before copyTree because mkdirSync is its first op —
  //? even a mid-copy throw leaves a partial directory that must be cleaned up.
  let dirCreatedByThisRun = false;
  try {
    console.log(`\nScaffolding ${slug} into ${targetDir}\n`);
    dirCreatedByThisRun = true;
    copyTree(TEMPLATE_DIR, targetDir, vars);

    //? Install the npm deps the selected monitoring/email providers need (before
    //? npm install runs), so the chosen integration is ready to use.
    injectOptionalDeps(targetDir, choices, luckystackVersion);

    //? Remove opt-OUT framework packages (e.g. presence) from the scaffold — drops
    //? the dependency AND the few files/lines that referenced it.
    pruneOptionalPackages(targetDir, choices);

    //? Non-prisma data layer (ADR 0020): strip the Prisma surface and wire the
    //? chosen ORM's starter files + deps + scripts (or the bring-your-own
    //? hooks for 'none'). Needs the rendered DATABASE_URL default from vars.
    if (choices.orm !== 'prisma') applyOrmChoice(targetDir, choices, vars.DATABASE_URL ?? '');

    //? Fully wire opt-IN packages that need more than a bare dependency. docs-ui
    //? self-wires via its `./register` subpath (dep alone is enough), so only
    //? secret-manager needs the enable-later code blocks uncommented here.
    if (choices.secretManager) wireSecretManager(targetDir);

    //? Presence is KEPT (not pruned) when opted in — flip the three gating flags
    //? in config.ts to `true` so the shipped client mounts actually render/emit
    //? (they default OFF, making a bare install a silent no-op). The prune path
    //? (presence OFF) never runs this, so the flags stay false there.
    if (choices.presence) wirePresence(targetDir);

    //? Router is a separate-process load-balancer: add its dependency + the
    //? `npm run router` script (topology lives in the scaffolded deploy.config.ts).
    if (choices.router) wireRouter(targetDir, luckystackVersion);

    //? AI dev-context is opt-in (the `aiInstructions` choice). When enabled we copy
    //? the framework's AI docs so the consumer's AI agents inherit full context,
    //? and install a pre-commit hook that keeps the AI snapshot files fresh. When
    //? disabled the project ships clean — no CLAUDE.md, no docs/luckystack, no hook.
    if (choices.aiInstructions) {
      copyAiDocs(targetDir, vars, luckystackVersion);
      //? Register the @luckystack/mcp graph server in .mcp.json so AI agents can
      //? query this project's dependency graph. Rides on the AI dev-context choice.
      wireGraphMcp(targetDir, luckystackVersion);
    }

    //? AI browser-testing tooling (agent-browser CLI + optional MCP servers).
    //? Additive, user-approval-gated, dev-tools only. No-op when 'none'.
    wireAiBrowserTooling(targetDir, choices);

    //? LAST file-producing step: record what this scaffold wrote (version +
    //? resolved choices + per-file hashes) in `.luckystack/scaffold.json` —
    //? the baseline `luckystack update` and future reconfigures diff against
    //? (ADR 0021). Must run after every write/prune/wire above and before
    //? `npm install` (node_modules is excluded defensively anyway).
    writeScaffoldManifest(targetDir, {
      luckystackVersion,
      projectName: slug,
      choices: { ...choices },
      isTextFile,
    });

    console.log('Files written.');

    if (args.install) {
      runNpmInstall(targetDir);
      //? Only the prisma data layer has a schema.prisma to generate from.
      if (choices.orm === 'prisma') runPrismaGenerate(targetDir);
    } else {
      console.log('\nSkipped npm install (--no-install).');
    }

    printNextSteps(choices, slug);
  } catch (error: unknown) {
    //? Roll back only if we created the directory — never remove a pre-existing dir.
    if (dirCreatedByThisRun) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // best-effort; ignore cleanup errors
      }
      console.error(`\n[create-luckystack-app] scaffold failed; removed partial directory "${targetDir}".`);
    }
    throw error;
  }
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
