import { describe, it, expect } from 'vitest';
import { parseDeclaredKeys, anyKeyDeclared } from './envKeys';

describe('parseDeclaredKeys', () => {
  it('collects uncommented assignment keys, never values', () => {
    const keys = parseDeclaredKeys('DEV_GOOGLE_CLIENT_ID=abc123\nRESEND_API_KEY=secret');
    expect([...keys].toSorted()).toEqual(['DEV_GOOGLE_CLIENT_ID', 'RESEND_API_KEY']);
  });

  it('skips commented (enable-later) lines', () => {
    const keys = parseDeclaredKeys('# DEV_GITHUB_CLIENT_ID=\n#SMTP_HOST=\nSENTRY_DSN=x');
    expect([...keys]).toEqual(['SENTRY_DSN']);
  });

  it('tolerates `export` and surrounding whitespace', () => {
    const keys = parseDeclaredKeys('  export POSTHOG_KEY=phc_x\n');
    expect([...keys]).toEqual(['POSTHOG_KEY']);
  });

  it('ignores blank lines and lines without an assignment', () => {
    const keys = parseDeclaredKeys('\n# just a comment\nNOT AN ASSIGNMENT\nFOO=1');
    expect([...keys]).toEqual(['FOO']);
  });
});

describe('anyKeyDeclared', () => {
  it('is true when any candidate key is present', () => {
    const declared = new Set(['GITHUB_CLIENT_ID']);
    expect(anyKeyDeclared(declared, ['DEV_GITHUB_CLIENT_ID', 'GITHUB_CLIENT_ID'])).toBe(true);
  });

  it('is false when none are present', () => {
    expect(anyKeyDeclared(new Set(['FOO']), ['DEV_GOOGLE_CLIENT_ID'])).toBe(false);
  });
});
