//? The numbered fallback prompts run whenever stdin/stdout is not a terminal
//? (pipes, CI). They used `rl.question()` per prompt: a pipe delivers every
//? answer in one chunk, readline emitted the lines nobody was waiting for as
//? plain 'line' events, and they were lost. When stdin then closed, the open
//? question never settled and the process exited 0 having scaffolded nothing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { collectFallbackAnswers, createLineReader, StdinClosedError } from './index';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const ENTRY = path.join(import.meta.dirname, 'index.ts');

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sink = (): PassThrough => {
  const out = new PassThrough();
  out.resume();
  return out;
};

describe('createLineReader', () => {
  it('keeps every line of a chunk that arrives before the questions are asked', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, sink());
    input.end('first\nsecond\nthird\n');
    expect(await reader.ask('? ')).toBe('first');
    expect(await reader.ask('? ')).toBe('second');
    expect(await reader.ask('? ')).toBe('third');
    reader.close();
  });

  it('rejects instead of hanging when stdin ends before the answer', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, sink());
    input.end('only one\n');
    expect(await reader.ask('? ')).toBe('only one');
    await expect(reader.ask('? ')).rejects.toBeInstanceOf(StdinClosedError);
  });

  it('rejects a question that is already waiting when stdin ends', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, sink());
    const pending = reader.ask('? ');
    input.end();
    await expect(pending).rejects.toBeInstanceOf(StdinClosedError);
  });
});

describe('collectFallbackAnswers', () => {
  it('reads one answer per question from a single piped chunk', async () => {
    const input = new PassThrough();
    const reader = createLineReader(input, sink());
    //? orm, db, auth, email, monitoring, presence, error-tracking, docs-ui,
    //? secret-manager, router, cron, AI docs, package manager.
    input.end(['2', '3', '', 'console', '', 'y', '', '', '', 'y', '', 'n', 'bun', ''].join('\n'));
    const answers = await collectFallbackAnswers({}, reader.ask);
    reader.close();
    expect(answers).toMatchObject({
      orm: 'drizzle',
      dbProvider: 'sqlite',
      authMode: 'none',
      emailProvider: 'console',
      monitoringProvider: 'none',
      presence: 'Yes',
      errorTracking: 'No',
      router: 'Yes',
      aiInstructions: 'No',
      packageManager: 'bun',
    });
  });

  it('does not ask about error-tracking once a monitoring backend is picked', async () => {
    const prompts: string[] = [];
    const answers = await collectFallbackAnswers(
      { orm: 'prisma', dbProvider: 'mongodb', authMode: 'none', emailProvider: 'none', monitoringProvider: 'sentry' },
      (prompt) => { prompts.push(prompt); return Promise.resolve(''); },
    );
    expect(prompts.some((prompt) => prompt.includes('@luckystack/error-tracking'))).toBe(false);
    expect(answers.errorTracking).toBeUndefined();
  });
});

describe('create-luckystack-app without a terminal (end to end)', () => {
  const run = (stdin: string) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-fallback-prompts-'));
    created.push(cwd);
    const result = spawnSync(TSX, [ENTRY, 'piped-app', '--no-install', '--no-ai-docs'], {
      cwd,
      input: stdin,
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { result, appDir: path.join(cwd, 'piped-app') };
  };

  it('scaffolds when every answer arrives in one piped chunk', () => {
    const { result, appDir } = run('\n'.repeat(30));
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(appDir, '.luckystack', 'scaffold.json'))).toBe(true);
  }, 120_000);

  it('exits non-zero and writes nothing when stdin is empty', () => {
    const { result, appDir } = run('');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stdin closed');
    expect(fs.existsSync(appDir)).toBe(false);
  }, 120_000);
});
