//? Guards the AI-context layer against template↔root drift — the #1 historical
//? defect class. The scaffold template ships byte-for-byte copies of the
//? AI-context generator scripts + eval harness; nothing else asserts
//? they stay in sync, so a future edit to one side silently diverges. This test
//? fails the moment a mirrored file drifts.
//?
//? Two sets:
//?   STRICT  — must be byte-identical between root and template/.
//?   SLIMMED — intentionally divergent (template drops framework-only checks);
//?             asserted structurally (template has the consumer-relevant gate,
//?             lacks the framework-only transport-parity) instead of byte-equal.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATE = path.join(REPO_ROOT, 'packages', 'create-luckystack-app', 'template');

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const readT = (rel: string): string => readFileSync(path.join(TEMPLATE, rel), 'utf8');

// Files shipped byte-for-byte to consumers.
const STRICT = [
  'scripts/generateLessonsIndex.mjs',
  'scripts/generateProjectIndex.mjs',
  'scripts/checkDocStaleness.mjs',
  'scripts/generateDecisionsIndex.mjs',
  'eval/scoreEval.mjs',
];

describe('AI-context script/doc parity (root ↔ scaffold template)', () => {
  for (const rel of STRICT) {
    it(`${rel} is byte-identical in the template`, () => {
      expect(readT(rel)).toBe(read(rel));
    });
  }

  it('template lintInvariants ships the consumer-relevant doc-coverage gate', () => {
    const t = readT('scripts/lintInvariants.mjs');
    expect(t).toContain('checkDocCoverage');
    expect(t).toContain('doc-coverage');
  });

  it('template lintInvariants omits the framework-only transport-parity check', () => {
    // The twin transport files do not exist in a consumer project, so this
    // structural check stays framework-only (intentional divergence).
    const t = readT('scripts/lintInvariants.mjs');
    expect(t).not.toContain('checkTransportParity');
  });

  it('template package.json exposes the new ai:* scripts', () => {
    const pkg: unknown = JSON.parse(readT('package.json'));
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {};
    for (const s of ['ai:lessons', 'ai:doc-staleness', 'ai:eval']) {
      expect(scripts).toHaveProperty(s);
    }
  });

  it('template package.json does not advertise retired or framework-only ai:* scripts', () => {
    //? `ai:index` regenerates the FRAMEWORK's cross-repo index — a consumer has
    //? no such script, so CLAUDE.md must not tell a consumer AI to run it.
    //? examples / runbooks / context-budget were retired outright.
    const pkg: unknown = JSON.parse(readT('package.json'));
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {};
    for (const s of ['ai:index', 'ai:examples', 'ai:runbooks', 'ai:context-budget']) {
      expect(scripts).not.toHaveProperty(s);
    }
  });
});
