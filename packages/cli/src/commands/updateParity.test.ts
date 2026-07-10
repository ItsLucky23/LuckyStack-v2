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
} from './update';
import {
  hashFileContent as scaffolderHash,
} from '../../../create-luckystack-app/src/scaffoldManifest';
import { isTextFile as scaffolderIsTextFile, VALID_FLAGS } from '../../../create-luckystack-app/src/index';

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

describe('choicesToFlags parity with the scaffolder flag surface', () => {
  it('every emitted flag is accepted by the scaffolder (VALID_FLAGS)', () => {
    const flags = choicesToFlags({
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
});
