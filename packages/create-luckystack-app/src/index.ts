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
  /** `--no-presence`: omit @luckystack/presence (applies under --no-prompt / CI). */
  noPresence: boolean;
  /** `--ai-browser=<all|agent-browser|none>`: AI browser-testing tooling (null = unspecified → DEFAULT_CHOICES). */
  aiBrowserTooling: AiBrowserTooling | null;
  //? CFG-01 — every wizard choice now has a matching CLI flag so the scaffold is
  //? fully scriptable (CI / AI / `--no-prompt`). `null` = flag not passed → the
  //? wizard asks (interactive) or the default applies (`--no-prompt`).
  dbProvider: DbProvider | null;
  authMode: AuthMode | null;
  /** From `--oauth=google,github,...`. `null` = not passed. Only used when authMode resolves to `credentials+oauth`. */
  oauthProviders: OAuthProvider[] | null;
  emailProvider: EmailProvider | null;
  monitoringProvider: MonitoringProvider | null;
  /** `--i18n` / `--no-i18n`. `null` = not passed. */
  i18n: boolean | null;
  /** `--no-ai-docs` (off) / `--ai-docs` (on). `null` = not passed. */
  aiInstructions: boolean | null;
}

//? Single source of truth for recognised flag tokens. Used both by the
//? parser (to reject unknown flags) and the help banner (so the list stays
//? in sync with what `parseArgs` actually accepts). The `--key=value` flags
//? are parsed in the default arm; they're listed here for the help/error banner.
export const VALID_FLAGS = [
  '--no-install', '--no-prompt',
  '--db=<mongodb|postgresql|mysql|sqlite>',
  '--auth=<none|credentials|credentials+oauth>',
  '--oauth=<google,github,discord,facebook,microsoft>',
  '--email=<none|console|resend|smtp>',
  '--monitoring=<none|sentry|datadog|posthog>',
  '--no-presence', '--i18n', '--no-i18n', '--ai-docs', '--no-ai-docs',
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
  let noPresence = false;
  let aiBrowserTooling: AiBrowserTooling | null = null;
  let dbProvider: DbProvider | null = null;
  let authMode: AuthMode | null = null;
  let oauthProviders: OAuthProvider[] | null = null;
  let emailProvider: EmailProvider | null = null;
  let monitoringProvider: MonitoringProvider | null = null;
  let i18n: boolean | null = null;
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
    case '--no-presence': {
    noPresence = true;
    break;
    }
    case '--i18n': {
    i18n = true;
    break;
    }
    case '--no-i18n': {
    i18n = false;
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
    projectName, install, prompt, help, noPresence, aiBrowserTooling,
    dbProvider, authMode, oauthProviders, emailProvider, monitoringProvider, i18n, aiInstructions,
  };
};

//? Single source of truth for the selectable provider lists. The wizard, the
//? non-interactive fallback prompts, the answer→choice conversion, and the
//? env-var builders all read from here so a new provider is added in exactly
//? one place. Declared `as const` so each list stays a readonly literal-union
//? tuple (drives the `ScaffoldChoices` field types below).
const PROVIDER_OPTIONS = {
  dbProvider: ['mongodb', 'postgresql', 'mysql', 'sqlite'],
  authMode: ['none', 'credentials', 'credentials+oauth'],
  oauthProviders: ['google', 'github', 'discord', 'facebook', 'microsoft'],
  emailProvider: ['none', 'console', 'resend', 'smtp'],
  monitoringProvider: ['none', 'sentry', 'datadog', 'posthog'],
  aiBrowserTooling: ['all', 'agent-browser', 'none'],
} as const;

type DbProvider = (typeof PROVIDER_OPTIONS.dbProvider)[number];
type AuthMode = (typeof PROVIDER_OPTIONS.authMode)[number];
type OAuthProvider = (typeof PROVIDER_OPTIONS.oauthProviders)[number];
type EmailProvider = (typeof PROVIDER_OPTIONS.emailProvider)[number];
type MonitoringProvider = (typeof PROVIDER_OPTIONS.monitoringProvider)[number];
type AiBrowserTooling = (typeof PROVIDER_OPTIONS.aiBrowserTooling)[number];

interface ScaffoldChoices {
  /** Database provider used in `schema.prisma`. */
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
  /** Enable @luckystack/i18n integration. */
  i18n: boolean;
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

const DEFAULT_CHOICES: ScaffoldChoices = {
  dbProvider: 'mongodb',
  authMode: 'credentials',
  oauthProviders: [],
  emailProvider: 'console',
  monitoringProvider: 'none',
  presence: true,
  i18n: true,
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
    if (need('dbProvider')) {
      answers.dbProvider = await pickFromList(rl, 'Which database provider do you want to use?', PROVIDER_OPTIONS.dbProvider, 'mongodb');
    }
    if (need('authMode')) {
      answers.authMode = await pickFromList(rl, 'Authentication mode?', PROVIDER_OPTIONS.authMode, 'credentials');
    }
    const authMode = asOption(answers.authMode, PROVIDER_OPTIONS.authMode, 'credentials');
    if (authMode === 'credentials+oauth' && need('oauthProviders')) {
      answers.oauthProviders = await pickMulti(rl, 'Which OAuth providers to wire?', PROVIDER_OPTIONS.oauthProviders);
    }
    if (need('emailProvider')) {
      answers.emailProvider = await pickFromList(rl, 'Transactional email adapter?', PROVIDER_OPTIONS.emailProvider, 'console');
    }
    if (need('monitoringProvider')) {
      answers.monitoringProvider = await pickFromList(rl, 'Observability backend?', PROVIDER_OPTIONS.monitoringProvider, 'none');
    }
    if (need('presence')) {
      answers.presence = (await askYesNo(rl, 'Install @luckystack/presence (AFK / presence / socket-status)?', true)) ? 'Yes' : 'No';
    }
    if (need('i18n')) {
      answers.i18n = (await askYesNo(rl, 'Enable i18n (translations + locale switching)?', true)) ? 'Yes' : 'No';
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

    const buildBlock = (): string => {
      const order = visibleSteps();
      const lines: string[] = [''];
      for (const [p, i] of order.entries()) {
        const step = steps[i];
        if (!step) continue;
        if (p < pointer) {
          const answer = answers[step.key];
          const shown = Array.isArray(answer) ? (answer.length > 0 ? answer.join(', ') : 'none') : (answer ?? '');
          lines.push(`${ansiStyle('✔', ANSI.green)} ${step.label} ${ansiStyle(shown, ANSI.cyan)}`);
          continue;
        }
        if (p > pointer) continue;
        lines.push(ansiStyle(step.label, ANSI.bold));
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
        const nextOrder = visibleSteps();
        pointer += 1;
        paint();
        if (pointer >= nextOrder.length) {
          restoreTerminal();
          resolve(answers);
        }
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
  const authMode = asOption(answers.authMode, PROVIDER_OPTIONS.authMode, 'credentials');
  const rawOauth = answers.oauthProviders;
  const oauthPicked = Array.isArray(rawOauth) ? rawOauth : [];

  return {
    dbProvider: asOption(answers.dbProvider, PROVIDER_OPTIONS.dbProvider, 'mongodb'),
    authMode,
    oauthProviders: authMode === 'credentials+oauth'
      ? PROVIDER_OPTIONS.oauthProviders.filter((provider) => oauthPicked.includes(provider))
      : [],
    emailProvider: asOption(answers.emailProvider, PROVIDER_OPTIONS.emailProvider, 'console'),
    monitoringProvider: asOption(answers.monitoringProvider, PROVIDER_OPTIONS.monitoringProvider, 'none'),
    presence: answers.presence !== 'No',
    i18n: answers.i18n === 'Yes',
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

  const answers = await runWizard([
    { key: 'dbProvider', type: 'select', label: 'Which database provider?', options: PROVIDER_OPTIONS.dbProvider, defaultValue: 'mongodb' },
    { key: 'authMode', type: 'select', label: 'Authentication mode?', options: PROVIDER_OPTIONS.authMode, defaultValue: 'credentials' },
    { key: 'oauthProviders', type: 'multi', label: 'Which OAuth providers to wire?', options: PROVIDER_OPTIONS.oauthProviders, skip: (a) => a.authMode !== 'credentials+oauth' },
    { key: 'emailProvider', type: 'select', label: 'Transactional email adapter?', options: PROVIDER_OPTIONS.emailProvider, defaultValue: 'console' },
    { key: 'monitoringProvider', type: 'select', label: 'Observability backend?', options: PROVIDER_OPTIONS.monitoringProvider, defaultValue: 'none' },
    { key: 'presence', type: 'select', label: 'Install @luckystack/presence (AFK / presence / socket-status)?', options: ['Yes', 'No'], defaultValue: 'Yes' },
    { key: 'i18n', type: 'select', label: 'Enable i18n (translations + locale switching)?', options: ['Yes', 'No'], defaultValue: 'Yes' },
    { key: 'aiInstructions', type: 'select', label: 'Include LuckyStack AI dev instructions (CLAUDE.md, docs, branch-logs, auto-index git hook)?', options: ['Yes', 'No'], defaultValue: 'Yes' },
    { key: 'aiBrowserTooling', type: 'select', label: 'Set up AI browser-testing tooling? (all = + Playwright/Chrome DevTools MCP; agent-browser = cheap CLI only; none)', options: PROVIDER_OPTIONS.aiBrowserTooling, defaultValue: 'agent-browser', skip: (a) => a.aiInstructions === 'No' },
  ], presets);

  return convertAnswersToChoices(answers);
};

//? Build the wizard/fallback answer-bag from CLI flags (CFG-01). Only keys that
//? were actually passed are set, so unspecified options still get asked (or fall
//? to defaults under `--no-prompt`). Booleans map to the wizard's Yes/No vocab.
const buildPresetAnswers = (args: CliArgs): Record<string, string | string[]> => {
  const presets: Record<string, string | string[]> = {};
  if (args.dbProvider) presets.dbProvider = args.dbProvider;
  if (args.authMode) presets.authMode = args.authMode;
  if (args.oauthProviders) presets.oauthProviders = args.oauthProviders;
  if (args.emailProvider) presets.emailProvider = args.emailProvider;
  if (args.monitoringProvider) presets.monitoringProvider = args.monitoringProvider;
  if (args.noPresence) presets.presence = 'No';
  if (args.i18n !== null) presets.i18n = args.i18n ? 'Yes' : 'No';
  if (args.aiInstructions !== null) presets.aiInstructions = args.aiInstructions ? 'Yes' : 'No';
  if (args.aiBrowserTooling) presets.aiBrowserTooling = args.aiBrowserTooling;
  return presets;
};

//? Enforce the cross-field invariants the wizard's `convertAnswersToChoices`
//? guarantees, for the `--no-prompt` (flags-over-defaults) path: OAuth providers
//? only matter under `credentials+oauth`, and browser tooling rides on the AI
//? template. Keeps both choice-resolution paths consistent.
const normalizeChoices = (choices: ScaffoldChoices): ScaffoldChoices => ({
  ...choices,
  oauthProviders: choices.authMode === 'credentials+oauth' ? choices.oauthProviders : [],
  aiBrowserTooling: choices.aiInstructions ? choices.aiBrowserTooling : 'none',
});

//? `--no-prompt` choice resolution: typed flag values layered over DEFAULT_CHOICES.
const buildNoPromptChoices = (args: CliArgs): ScaffoldChoices => {
  const choices: ScaffoldChoices = { ...DEFAULT_CHOICES };
  if (args.dbProvider) choices.dbProvider = args.dbProvider;
  if (args.authMode) choices.authMode = args.authMode;
  if (args.oauthProviders) choices.oauthProviders = args.oauthProviders;
  if (args.emailProvider) choices.emailProvider = args.emailProvider;
  if (args.monitoringProvider) choices.monitoringProvider = args.monitoringProvider;
  if (args.noPresence) choices.presence = false;
  if (args.i18n !== null) choices.i18n = args.i18n;
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
  --db=<mongodb|postgresql|mysql|sqlite>      Database provider.
  --auth=<none|credentials|credentials+oauth> Authentication mode ('none' = no auth).
  --oauth=<google,github,discord,facebook,microsoft>  OAuth providers (comma list; needs --auth=credentials+oauth).
  --email=<none|console|resend|smtp>          Transactional email adapter.
  --monitoring=<none|sentry|datadog|posthog>  Observability backend.
  --no-presence  Omit @luckystack/presence.
  --i18n / --no-i18n   Enable / disable i18n (translations + locale switching).
  --ai-docs / --no-ai-docs   Include / omit LuckyStack AI dev instructions.
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

export const buildOAuthEnvVars = (providers: readonly string[]): string => {
  const selected = new Set(providers);
  const intro = [
    '# OAuth client credentials. Providers you picked at scaffold time are',
    '# uncommented; the rest are commented out — fill a pair and uncomment to',
    '# enable later (no code edit: oauthProviders.ts wires every built-in provider',
    '# by env). DEV_* are read when NODE_ENV is not "production"; the unprefixed',
    '# pair is read in production. A provider stays disabled until BOTH its id and',
    '# secret are set.',
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
        '# Sends only in production by default; SENTRY_ENABLED=true forces dev capture.',
        'SENTRY_DSN=', '# SENTRY_ENABLED=true']
      : ['# Sentry (enable later): npm i @sentry/node, then set SENTRY_DSN + restart.',
        '# SENTRY_DSN=', '# SENTRY_ENABLED=true'],
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
//? (docs/AI_CAPABILITIES.md + docs/AI_PROJECT_INDEX.md + docs/AI_DECISIONS_INDEX.md
//? + docs/AI_RUNBOOKS.md + docs/AI_PRODUCT_OVERVIEW.md + docs/ai-graph.json) and stages them, so they never drift. Mirrors the
//? framework repo's own hook. Wired via a
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
echo "[pre-commit] Checking CLAUDE.md invariants on staged changes..."
npm run ai:lint --silent
echo "[pre-commit] Regenerating docs/AI_CAPABILITIES.md..."
npm run ai:capabilities --silent
echo "[pre-commit] Regenerating docs/AI_PROJECT_INDEX.md..."
npm run ai:project-index --silent
echo "[pre-commit] Regenerating docs/AI_DECISIONS_INDEX.md..."
npm run ai:decisions --silent
echo "[pre-commit] Regenerating docs/AI_RUNBOOKS.md..."
npm run ai:runbooks --silent
echo "[pre-commit] Regenerating docs/AI_PRODUCT_OVERVIEW.md..."
npm run ai:product --silent
echo "[pre-commit] Regenerating docs/ai-graph.json..."
npm run ai:graph --silent
git add docs/AI_CAPABILITIES.md docs/AI_PROJECT_INDEX.md docs/AI_DECISIONS_INDEX.md docs/AI_RUNBOOKS.md docs/AI_PRODUCT_OVERVIEW.md docs/ai-graph.json
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
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string | undefined> };
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

  if (Object.keys(deps).length === 0 && Object.keys(devDeps).length === 0) return;

  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
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
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
  if (pkg.dependencies && depName in pkg.dependencies) {
    const { [depName]: _removed, ...rest } = pkg.dependencies;
    pkg.dependencies = rest;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
};

//? Delete a file or directory (recursively) from the scaffolded project. Used
//? by the choice-gated prunes (`authMode: 'none'` removes auth pages/APIs;
//? `i18n: false` removes the extra-language locale files). A missing path is a
//? silent no-op so the prune is idempotent. `relPath` is always repo-internal
//? (built from literals here), never user input.
const removeScaffoldPath = (targetDir: string, relPath: string): void => {
  const full = path.join(targetDir, relPath);
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
  const data: Record<string, unknown> = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>)
    : {};
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
      servers.playwright ??= { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'] };
      servers['chrome-devtools'] ??= { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@latest'] };
    });

    //? Deterministic CI complement (devDep + one example spec).
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { devDependencies?: Record<string, string> };
      pkg.devDependencies = { ...pkg.devDependencies, '@playwright/test': '^1.50.0' };
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
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

//? Remove OPT-OUT packages from a freshly-copied scaffold. Only handles genuinely
//? bounded packages today (presence). login/sync are more deeply woven (login is a
//? whole auth surface; sync's `initSyncRequest` is called from the presence/activity
//? path in socketInitializer) — see docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md §6.
const pruneOptionalPackages = (targetDir: string, choices: ScaffoldChoices): void => {
  if (!choices.presence) {
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
  }

  if (choices.authMode === 'none') {
    //? Auth-less scaffold. The framework's (anonymous) session plumbing stays —
    //? `session_v1` returns a null user, `SessionProvider`/`useSession` resolve to
    //? "no session", and the sockets still run — but every built-in auth UI/flow
    //? is removed: the credentials/OAuth login + register + password-reset pages,
    //? the account-management settings page, the LoginForm, and the `functions/
    //? session` shim (which re-exported @luckystack/login). The direct
    //? @luckystack/login dependency is dropped (framework packages still pull it
    //? transitively for their own internals); no scaffold code imports it after
    //? this prune. Run BEFORE the i18n prune so its settings/page.tsx edit safely
    //? no-ops on the now-removed file.
    dropDependency(targetDir, '@luckystack/login');
    for (const target of [
      'src/login',
      'src/register',
      'src/reset-password',
      'src/settings',
      'src/_components/LoginForm.tsx',
      'functions/session.ts',
      //? Auth/account transactional-email hooks (new-sign-in + password-change).
      //? They register a `postLogin` hook whose payload type ships with
      //? @luckystack/login — which we just dropped — and the password-change
      //? helper was only called by the (now-removed) settings page.
      'server/hooks/notifications.ts',
    ]) {
      removeScaffoldPath(targetDir, target);
    }

    //? Server overlay registered the notification hooks + an example postLogin
    //? logger. Both reference login-only hook payloads; strip them so the
    //? overlay compiles without @luckystack/login (leave a minimal placeholder).
    editScaffoldFile(targetDir, 'luckystack/server/index.ts', [
      [
        `import { registerHook } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads \`user.preferences\` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with \`{ ok: false, reason: 'no-sender' }\`.
registerNotificationHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (process.env.NODE_ENV !== 'production') {
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
    //? Framework-mode forgot-password (needs @luckystack/email installed + a
    //? sender registered in server.ts). Set to 'disabled' or 'custom' to opt out.
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
  }

  if (!choices.i18n) {
    //? Single-language (English) scaffold. The translator layer itself stays —
    //? it lives in @luckystack/core and backs every `translate()` call — so all
    //? components keep compiling; what we remove is the EXTRA languages + the
    //? locale switcher. Drop nl/de/fr locale files, reduce the locale registry
    //? to English, and collapse the settings language picker to a single option.
    removeScaffoldPath(targetDir, 'src/_locales/nl.json');
    removeScaffoldPath(targetDir, 'src/_locales/de.json');
    removeScaffoldPath(targetDir, 'src/_locales/fr.json');
    editScaffoldFile(targetDir, 'luckystack/i18n/locales.ts', [
      ["import deJson from 'src/_locales/de.json';\n", ''],
      ["import frJson from 'src/_locales/fr.json';\n", ''],
      ["import nlJson from 'src/_locales/nl.json';\n", ''],
      [
        `registerLocales({
  en: enJson,
  nl: nlJson,
  de: deJson,
  fr: frJson,
});`,
        `registerLocales({
  en: enJson,
});`,
      ],
    ]);
    //? Picker → English only. editScaffoldFile is a no-op when settings/ was
    //? already removed by the authMode:'none' prune, so the order is safe.
    //? The `newLanguage` state is also re-seeded to `'en'` — with `Language`
    //? narrowed to `'en'`, the original `session?.language ?? 'en'` seed (the
    //? session language is a wider union) no longer type-checks.
    editScaffoldFile(targetDir, 'src/settings/page.tsx', [
      ["const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;", "const LANGUAGES = ['en'] as const;"],
      [
        "  const [newLanguage, setNewLanguage] = useState<Language>(session?.language ?? 'en');",
        "  const [newLanguage, setNewLanguage] = useState<Language>('en');",
      ],
    ]);
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

  //? Choice resolution. Every wizard option also has a CLI flag (CFG-01):
  //?   - interactive (`--prompt`, default): flags PRE-FILL the matching wizard
  //?     steps (which are then skipped) and the user is only asked for the rest;
  //?   - `--no-prompt`: typed flag values layered over DEFAULT_CHOICES, no prompts.
  const choices: ScaffoldChoices = args.prompt
    ? await runPrompts(buildPresetAnswers(args))
    : buildNoPromptChoices(args);

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

  const luckystackVersion = readSelfVersion();
  const vars: Record<string, string> = {
    PROJECT_NAME: slug,
    PROJECT_TITLE: titleCase(args.projectName),
    LUCKYSTACK_VERSION: luckystackVersion,
    DB_PROVIDER: choices.dbProvider,
    USER_ID_ATTRS: USER_ID_ATTRS_BY_PROVIDER[choices.dbProvider] ?? '@id @default(cuid())',
    DATABASE_URL: DATABASE_URL_BY_PROVIDER[choices.dbProvider] ?? `postgresql://user:password@localhost:5432/${slug}`,
    AUTH_MODE: choices.authMode,
    OAUTH_PROVIDERS: choices.oauthProviders.join(','),
    OAUTH_ENV_VARS: buildOAuthEnvVars(choices.oauthProviders),
    EXTERNAL_ORIGINS: externalOrigins,
    EMAIL_PROVIDER: choices.emailProvider,
    EMAIL_ENV_VARS: buildEmailEnvVars(choices.emailProvider),
    MONITORING_PROVIDER: choices.monitoringProvider,
    MONITORING_ENV_VARS: buildMonitoringEnvVars(choices.monitoringProvider),
    I18N_ENABLED: choices.i18n ? 'true' : 'false',
  };

  console.log(`\nScaffolding ${slug} into ${targetDir}\n`);
  copyTree(TEMPLATE_DIR, targetDir, vars);

  //? Install the npm deps the selected monitoring/email providers need (before
  //? npm install runs), so the chosen integration is ready to use.
  injectOptionalDeps(targetDir, choices, luckystackVersion);

  //? Remove opt-OUT framework packages (e.g. presence) from the scaffold — drops
  //? the dependency AND the few files/lines that referenced it.
  pruneOptionalPackages(targetDir, choices);

  //? AI dev-context is opt-in (the `aiInstructions` choice). When enabled we copy
  //? the framework's AI docs so the consumer's AI agents inherit full context,
  //? and install a pre-commit hook that keeps the AI snapshot files fresh. When
  //? disabled the project ships clean — no CLAUDE.md, no docs/luckystack, no hook.
  if (choices.aiInstructions) {
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
      [path.join(base, 'CLAUDE.md'),                                                 path.join(targetDir, 'CLAUDE.md'),                  false],
      [path.join(base, 'docs'),                                                      path.join(targetDir, 'docs', 'luckystack'),         true],
      [path.join(base, 'skills'),                                                    path.join(targetDir, 'skills'),                     true],
      [fromBundle ? path.join(base, 'claude-commands') : path.join(base, '.claude', 'commands'),   path.join(targetDir, '.claude', 'commands'),        true],
      [fromBundle ? path.join(base, 'branch-logs-README.md') : path.join(base, 'branch-logs', 'README.md'), path.join(targetDir, 'branch-logs', 'README.md'), false],
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

    //? Wire the @luckystack/mcp server into .mcp.json so the consumer's Claude
    //? Code can QUERY the committed AI context (decisions, dependency graph,
    //? routes, runbooks, capabilities) instead of loading whole files. Run via
    //? npx — no app dependency. Additive (mergeJsonFile + ??=), so it coexists
    //? as a SEPARATE entry alongside the playwright/chrome-devtools browser MCP
    //? servers that wireAiBrowserTooling adds (they are not merged into one).
    //? Gated on the AI instructions (it's repo-context tooling), not on the
    //? browser-testing choice.
    mergeJsonFile(path.join(targetDir, '.mcp.json'), (data) => {
      const servers = (data.mcpServers ??= {}) as Record<string, unknown>;
      servers.luckystack ??= { type: 'stdio', command: 'npx', args: ['@luckystack/mcp@latest'] };
    });

    if (copiedCount > 0) {
      console.log(`Framework AI documentation copied (${copiedCount} source(s) merged into target) + pre-commit AI-index hook + @luckystack/mcp server installed.`);
    }
  }

  //? AI browser-testing tooling (agent-browser CLI + optional MCP servers).
  //? Additive, user-approval-gated, dev-tools only. No-op when 'none'.
  wireAiBrowserTooling(targetDir, choices);

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
  presence:    ${choices.presence ? 'installed' : 'skipped'}
  i18n:        ${choices.i18n ? 'on' : 'off'}
  ai-docs:     ${choices.aiInstructions ? 'included (+ pre-commit AI-index hook)' : 'skipped'}
  ai-browser:  ${choices.aiBrowserTooling}

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
