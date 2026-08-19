import { describe, it, expect, vi, beforeEach } from 'vitest';

//? Regression cover for the crash-loop a real consumer hit: a post-listen queue
//? worker could not reach its database, the rejection landed in the scaffolded
//? IIFE's `.catch` -> `process.exit(1)`, and the supervisor restarted a server
//? that had already bound its port. The dependency was still down on the next
//? boot, so it looped — while the log claimed "failed to start".

const errorSpy = vi.fn();
vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return { ...actual, getLogger: () => ({ error: errorSpy }) };
});

const { runAfterListenTask } = await import('./afterListen');

beforeEach(() => {
  errorSpy.mockClear();
});

describe('runAfterListenTask', () => {
  it('runs the task and resolves when it succeeds', async () => {
    const task = vi.fn(async () => undefined);
    await expect(runAfterListenTask(task)).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('swallows a rejection by default and logs it', async () => {
    //? The whole point: this must NOT reject, or it lands in the caller's fatal
    //? `.catch` and takes down a server that is already serving traffic.
    await expect(
      runAfterListenTask(async () => { throw new Error('mongo unreachable'); }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledOnce();
    const [message, error] = errorSpy.mock.calls[0] ?? [];
    expect(String(message)).toContain('the server is listening and stays up');
    expect((error as Error).message).toBe('mongo unreachable');
  });

  it('names the task in the failure log', async () => {
    await runAfterListenTask(async () => { throw new Error('boom'); }, { label: 'attachment workers' });
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('attachment workers');
  });

  it('falls back to a generic label', async () => {
    await runAfterListenTask(async () => { throw new Error('boom'); });
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('post-listen task');
  });

  it('propagates when fatal is true', async () => {
    //? Opt-in escape hatch for a process that genuinely cannot run without it.
    await expect(
      runAfterListenTask(async () => { throw new Error('no license'); }, { fatal: true }),
    ).rejects.toThrow('no license');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('handles a synchronous throw the same way', async () => {
    await expect(
      runAfterListenTask(() => { throw new Error('sync boom'); }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

describe('the scaffolded server template wires it', () => {
  it('documents the afterListen slot without shipping a lint error', async () => {
    //? The fix only lands for consumers if the template points at it — but the
    //? example must ship COMMENTED OUT. The scaffold lints `**/*.{ts,tsx}` with
    //? `strictTypeChecked` + `stylisticTypeChecked`, so a live empty callback
    //? trips `require-await` (async, no await) or `no-empty-function`, and every
    //? new project would start with a lint error. The e2e runs typecheck +
    //? build, not lint, so nothing else catches this.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const template = readFileSync(
      path.resolve(__dirname, '..', '..', 'create-luckystack-app', 'template', 'server', 'server.ts'),
      'utf8',
    );

    expect(template).toContain('server.afterListen(');
    //? Every line mentioning it must be a comment.
    const liveCall = template
      .split('\n')
      .filter((line) => line.includes('server.afterListen('))
      .filter((line) => !line.trimStart().startsWith('//'));
    expect(liveCall).toEqual([]);

    //? And the fatal catch must still be there for pre-listen failures.
    expect(template).toContain("console.error('[server] failed to start:', err)");
  });
});
