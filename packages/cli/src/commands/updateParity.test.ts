//? Cross-package drift guards for `luckystack update` (ADR 0021). Both were
//? previously only enforced by the verdaccio e2e:
//? 1. HASH PARITY — the cli re-implements the scaffolder's manifest hashing
//?    (zero-dep policy forbids importing the scaffolder at runtime). If the
//?    implementations disagree on even one extension, every such file reads
//?    as "user-modified" and update degrades to sidecar-spam.
//? 2. FLAG PARITY — `choicesToFlags` replays recorded choices as scaffolder
//?    CLI flags; an emitted flag the scaffolder no longer accepts makes the
//?    temp re-render exit(2) and update fail with a generic error.
import { describe, expect, it } from 'vitest';
import {
  hashFileContent as cliHash,
  isTextFile as cliIsTextFile,
  choicesToFlags,
  isSafeWindowsScaffoldArg,
  normalizeScaffoldProjectName,
} from './update';
import {
  hashFileContent as scaffolderHash,
} from '../../../create-luckystack-app/src/scaffoldManifest';
import { isTextFile as scaffolderIsTextFile, VALID_FLAGS, DEFAULT_CHOICES } from '../../../create-luckystack-app/src/index';

const SAMPLE_PATHS = [
  'CLAUDE.md',
  'docs/luckystack/ARCHITECTURE_API.md',
  'scripts/generateGraph.mjs',
  'scripts/generateTypeMaps.ts',
  '.claude/commands/save.md',
  '.luckystack/templates/page.tsx',
  'skills/custom/foo.md',
  'eslint.luckystack.config.js',
  '.gitignore',
  'assets/logo.png',
  'eval/scoreEval.mjs',
  'branch-logs/README.md',
];

const SAMPLE_CONTENTS = [
  Buffer.from('plain\ntext\n'),
  Buffer.from('crlf\r\ntext\r\n'),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
];

describe('update hash parity with the scaffolder manifest writer', () => {
  it('agrees on text-vs-binary classification for every safe-surface shape', () => {
    for (const samplePath of SAMPLE_PATHS) {
      expect(cliIsTextFile(samplePath), samplePath).toBe(scaffolderIsTextFile(samplePath));
    }
  });

  it('produces identical hashes for identical (path, content) pairs', () => {
    for (const samplePath of SAMPLE_PATHS) {
      for (const content of SAMPLE_CONTENTS) {
        expect(
          cliHash(content, cliIsTextFile(samplePath)),
          `${samplePath} (${String(content.length)} bytes)`,
        ).toBe(scaffolderHash(content, scaffolderIsTextFile(samplePath)));
      }
    }
  });
});

//? 3. REVERSE FLAG PARITY — the direction (2) does NOT cover. A choice that is
//?    RECORDED in the manifest but never replayed by `choicesToFlags` silently
//?    reverts to its default on re-render: the fresh scaffold then differs from
//?    the project on that choice's files, so every `update` reports them as
//?    user-modified and spams `.new` sidecars. This is not hypothetical — the
//?    `--pm=bun` axis shipped with exactly this gap, and direction (2) stayed
//?    green throughout, because an ABSENT flag is trivially a valid one.
//?    The probe map below is asserted EXHAUSTIVE against `DEFAULT_CHOICES`, so
//?    adding a wizard choice without wiring its replay fails here.
const REPLAY_PROBES: Record<string, { value: unknown; expected: string }> = {
  packageManager: { value: 'bun', expected: '--pm=bun' },
  orm: { value: 'drizzle', expected: '--orm=drizzle' },
  dbProvider: { value: 'postgresql', expected: '--db=postgresql' },
  authMode: { value: 'credentials+oauth', expected: '--auth=credentials+oauth' },
  oauthProviders: { value: ['google', 'github'], expected: '--oauth=google,github' },
  emailProvider: { value: 'resend', expected: '--email=resend' },
  monitoringProvider: { value: 'sentry', expected: '--monitoring=sentry' },
  presence: { value: true, expected: '--presence' },
  errorTracking: { value: true, expected: '--error-tracking' },
  docsUi: { value: true, expected: '--docs-ui' },
  secretManager: { value: true, expected: '--secret-manager' },
  router: { value: true, expected: '--router' },
  cron: { value: true, expected: '--cron' },
  aiInstructions: { value: false, expected: '--no-ai-docs' },
  aiBrowserTooling: { value: 'all', expected: '--ai-browser=all' },
};

describe('choicesToFlags parity with the scaffolder flag surface', () => {
  it('every emitted flag is accepted by the scaffolder (VALID_FLAGS)', () => {
    const flags = choicesToFlags({
      packageManager: 'bun',
      orm: 'prisma',
      dbProvider: 'postgresql',
      authMode: 'credentials+oauth',
      oauthProviders: ['google', 'github'],
      emailProvider: 'resend',
      monitoringProvider: 'sentry',
      presence: true,
      errorTracking: true,
      docsUi: true,
      secretManager: true,
      router: true,
      cron: true,
      aiInstructions: false,
      aiBrowserTooling: 'agent-browser',
    });
    const validPrefixes = VALID_FLAGS.map((entry) => {
      const eq = entry.indexOf('=');
      return eq === -1 ? entry : entry.slice(0, eq + 1);
    });
    for (const flag of flags) {
      const eq = flag.indexOf('=');
      const key = eq === -1 ? flag : flag.slice(0, eq + 1);
      expect(validPrefixes, `flag ${flag} must be a scaffolder flag`).toContain(key);
    }
  });

  it('every recorded choice is replayed as a flag (reverse parity)', () => {
    for (const [key, probe] of Object.entries(REPLAY_PROBES)) {
      const flags = choicesToFlags({ [key]: probe.value });
      expect(
        flags,
        `choice "${key}" is recorded in the scaffold manifest but choicesToFlags emits no flag for it — ` +
          `update would re-render without it and sidecar-spam every file that choice affects`,
      ).toContain(probe.expected);
    }
  });

  it('the replay probes cover every key in DEFAULT_CHOICES', () => {
    //? The guard that makes the test above self-maintaining: a new wizard choice
    //? lands in DEFAULT_CHOICES, this fails, and whoever added it must either
    //? wire the replay or consciously document why it needs none.
    expect(Object.keys(REPLAY_PROBES).toSorted()).toEqual(Object.keys(DEFAULT_CHOICES).toSorted());
  });

  it('a manifest predating the --pm axis replays no package-manager flag', () => {
    //? Back-compat: a pre-0.7 scaffold has no `packageManager` key, so the
    //? re-render must fall back to the npm default rather than emit `--pm=`.
    const flags = choicesToFlags({ orm: 'prisma', dbProvider: 'mongodb' });
    expect(flags.some((flag) => flag.startsWith('--pm='))).toBe(false);
  });

  it('drops hand-edited unknown values before they can reach npx.cmd', () => {
    const flags = choicesToFlags({
      packageManager: 'npm & whoami',
      orm: 'prisma | calc',
      dbProvider: 'postgresql > stolen.txt',
      authMode: 'credentials',
      oauthProviders: ['google', 'github&whoami', 42],
      emailProvider: 'resend',
      monitoringProvider: 'posthog',
      aiBrowserTooling: 'all && whoami',
    });
    expect(flags).toEqual([
      '--auth=credentials',
      '--oauth=google',
      '--email=resend',
      '--monitoring=posthog',
    ]);
    expect(flags.every(isSafeWindowsScaffoldArg)).toBe(true);
  });
});

describe('update scaffold command boundary', () => {
  it('uses the exact scaffolder slug for directory names with spaces/metacharacters', () => {
    expect(normalizeScaffoldProjectName('  My Project & whoami  ')).toBe('my-project-whoami');
    expect(normalizeScaffoldProjectName('***')).toBe('');
  });

  it('rejects cmd metacharacters and whitespace while accepting every generated shape', () => {
    expect(isSafeWindowsScaffoldArg('my-project')).toBe(true);
    expect(isSafeWindowsScaffoldArg('create-luckystack-app@0.7.3')).toBe(true);
    expect(isSafeWindowsScaffoldArg('--auth=credentials+oauth')).toBe(true);
    expect(isSafeWindowsScaffoldArg('--oauth=google,github')).toBe(true);
    for (const unsafe of ['my project', 'x&whoami', 'x|whoami', 'x>file', 'x^y', 'x%PATH%']) {
      expect(isSafeWindowsScaffoldArg(unsafe), unsafe).toBe(false);
    }
  });
});
