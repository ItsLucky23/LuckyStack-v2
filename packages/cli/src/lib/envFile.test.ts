import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasSentinelBlock,
  appendSentinelBlock,
  removeSentinelBlock,
  addOrigin,
  removeOrigin,
  upsertEnvBlock,
  dropEnvBlock,
} from './envFile';
import { emailEnvLines, blockPlaceholderDefaults } from '../featureOptions';

describe('sentinel blocks', () => {
  it('appends a delimited block and detects it', () => {
    const out = appendSentinelBlock('FOO=1\n', 'oauth:google', ['DEV_GOOGLE_CLIENT_ID=']);
    expect(hasSentinelBlock(out, 'oauth:google')).toBe(true);
    expect(out).toContain('# >>> luckystack:oauth:google >>>');
    expect(out).toContain('DEV_GOOGLE_CLIENT_ID=');
    expect(out).toContain('# <<< luckystack:oauth:google <<<');
  });

  it('round-trips: remove returns to the original (modulo trailing newline)', () => {
    const start = 'FOO=1\n';
    const added = appendSentinelBlock(start, 'oauth:github', ['DEV_GITHUB_CLIENT_ID=']);
    const removed = removeSentinelBlock(added, 'oauth:github');
    expect(removed.trim()).toBe('FOO=1');
    expect(hasSentinelBlock(removed, 'oauth:github')).toBe(false);
  });

  it('remove is a no-op when the block is absent', () => {
    expect(removeSentinelBlock('FOO=1\n', 'oauth:google')).toBe('FOO=1\n');
  });
});

describe('CRLF safety (writeText re-applies CRLF, so producers must return pure LF)', () => {
  it('appendSentinelBlock normalizes CRLF input (no stray \\r)', () => {
    const out = appendSentinelBlock('FOO=1\r\nBAR=2\r\n', 'oauth:x', ['K=']);
    expect(out).not.toMatch(/\r/);
    expect(out).toContain('# >>> luckystack:oauth:x >>>');
  });
  it('addOrigin create-line branch normalizes CRLF input (no stray \\r)', () => {
    const out = addOrigin('FOO=1\r\nBAR=2\r\n', 'https://a.com');
    expect(out).not.toMatch(/\r/);
    expect(out).toContain('EXTERNAL_ORIGINS=https://a.com');
  });
});

describe('EXTERNAL_ORIGINS', () => {
  it('adds the key line when absent', () => {
    expect(addOrigin('FOO=1\n', 'https://accounts.google.com')).toContain('EXTERNAL_ORIGINS=https://accounts.google.com');
  });

  it('appends de-duplicated to an existing line', () => {
    const out = addOrigin('EXTERNAL_ORIGINS=https://a.com\n', 'https://b.com');
    expect(out).toContain('EXTERNAL_ORIGINS=https://a.com,https://b.com');
    expect(addOrigin(out, 'https://b.com')).toBe(out);
  });

  it('removes an origin, leaving the rest', () => {
    const out = removeOrigin('EXTERNAL_ORIGINS=https://a.com,https://b.com\n', 'https://a.com');
    expect(out).toContain('EXTERNAL_ORIGINS=https://b.com');
    expect(out).not.toContain('a.com');
  });

  it('remove is a no-op when the origin is absent', () => {
    const text = 'EXTERNAL_ORIGINS=https://a.com\n';
    expect(removeOrigin(text, 'https://z.com')).toBe(text);
  });
});

describe('upsertEnvBlock / dropEnvBlock (file, value-safe)', () => {
  let dir: string;
  const localPath = (): string => path.join(dir, '.env.local');
  const readLocal = (): string => fs.readFileSync(localPath(), 'utf8');

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-env-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('appends a placeholder block when absent, idempotent on re-run', () => {
    expect(upsertEnvBlock(dir, 'oauth:google', ['DEV_GOOGLE_CLIENT_ID='], new Set(), ['DEV_GOOGLE_CLIENT_ID'])).toBe('added');
    const first = fs.readFileSync(localPath(), 'utf8');
    expect(first).toContain('# >>> luckystack:oauth:google >>>');
    //? Second run: sentinel present → skipped, file unchanged.
    expect(upsertEnvBlock(dir, 'oauth:google', ['DEV_GOOGLE_CLIENT_ID='], new Set(), ['DEV_GOOGLE_CLIENT_ID'])).toBe('skipped');
    expect(fs.readFileSync(localPath(), 'utf8')).toBe(first);
  });

  it('NEVER touches an existing (possibly secret-bearing) line — skips when the key is already declared', () => {
    fs.writeFileSync(localPath(), 'DEV_GOOGLE_CLIENT_ID=super-secret-value\n');
    const before = fs.readFileSync(localPath(), 'utf8');
    const result = upsertEnvBlock(dir, 'oauth:google', ['DEV_GOOGLE_CLIENT_ID='], new Set(['DEV_GOOGLE_CLIENT_ID']), ['DEV_GOOGLE_CLIENT_ID']);
    expect(result).toBe('skipped');
    expect(fs.readFileSync(localPath(), 'utf8')).toBe(before); // value preserved untouched
  });

  it('KEEPS a CLI-written block when the developer filled a value inside it (never destroys a secret)', () => {
    upsertEnvBlock(dir, 'oauth:google', ['DEV_GOOGLE_CLIENT_ID='], new Set(), ['DEV_GOOGLE_CLIENT_ID']);
    //? Developer fills the placeholder with a real secret.
    fs.writeFileSync(localPath(), readLocal().replace('DEV_GOOGLE_CLIENT_ID=', 'DEV_GOOGLE_CLIENT_ID=real-secret'));
    expect(dropEnvBlock(dir, 'oauth:google')).toBe('kept');
    expect(readLocal()).toContain('real-secret'); // value preserved
  });

  it('removes a placeholder-only block whose only "filled" lines are SHIPPED DEFAULTS', () => {
    //? email:resend ships RESEND_API_KEY= (empty) + EMAIL_FROM=noreply@example.com
    //? (a non-empty default). Untouched, the block must auto-remove — the shipped
    //? default is not a developer secret.
    upsertEnvBlock(dir, 'email:resend', emailEnvLines('resend'), new Set(), ['RESEND_API_KEY']);
    expect(dropEnvBlock(dir, 'email:resend', blockPlaceholderDefaults('email:resend'))).toBe('removed');
    expect(readLocal()).not.toContain('luckystack:email:resend');
  });

  it('KEEPS a block when the developer changed a shipped default or filled an empty key', () => {
    //? Developer filled the real secret → kept.
    upsertEnvBlock(dir, 'email:resend', emailEnvLines('resend'), new Set(), ['RESEND_API_KEY']);
    fs.writeFileSync(localPath(), readLocal().replace('RESEND_API_KEY=', 'RESEND_API_KEY=re_live_secret'));
    expect(dropEnvBlock(dir, 'email:resend', blockPlaceholderDefaults('email:resend'))).toBe('kept');
    expect(readLocal()).toContain('re_live_secret');

    //? Developer changed the shipped default value → treated as a real value, kept.
    fs.rmSync(localPath());
    upsertEnvBlock(dir, 'email:resend', emailEnvLines('resend'), new Set(), ['RESEND_API_KEY']);
    fs.writeFileSync(localPath(), readLocal().replace('EMAIL_FROM=noreply@example.com', 'EMAIL_FROM=hi@acme.com'));
    expect(dropEnvBlock(dir, 'email:resend', blockPlaceholderDefaults('email:resend'))).toBe('kept');
    expect(readLocal()).toContain('hi@acme.com');
  });

  it('drops a CLI-written block but KEEPS a hand-filled (sentinel-less) block', () => {
    //? CLI-written block → removed.
    upsertEnvBlock(dir, 'oauth:github', ['DEV_GITHUB_CLIENT_ID='], new Set(), ['DEV_GITHUB_CLIENT_ID']);
    expect(dropEnvBlock(dir, 'oauth:github')).toBe('removed');
    expect(fs.readFileSync(localPath(), 'utf8')).not.toContain('DEV_GITHUB_CLIENT_ID');

    //? Hand-filled block (no sentinel) → kept (value-safety).
    fs.writeFileSync(localPath(), 'DEV_DISCORD_CLIENT_ID=filled-by-user\n');
    expect(dropEnvBlock(dir, 'oauth:discord')).toBe('kept');
    expect(fs.readFileSync(localPath(), 'utf8')).toContain('filled-by-user');
  });
});
