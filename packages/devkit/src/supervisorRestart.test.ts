import type { EventEmitter } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RESTART_MESSAGE_TYPE } from './devServerRestart';

//? Child lifecycle of the dev supervisor, with `spawn` replaced by fake
//? children. Every spawned child would bind the dev port, so "how many children
//? were spawned" is the observable that matters.

interface FakeChild extends EventEmitter {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

const { spawned } = vi.hoisted(() => ({ spawned: [] as FakeChild[] }));

vi.mock('node:child_process', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new Emitter(), { pid: 1000 + spawned.length, kill: vi.fn() }) as FakeChild;
      spawned.push(child);
      return child;
    }),
  };
});

let supervisor: typeof import('./supervisor');

beforeAll(() => {
  process.env.LUCKYSTACK_SUPERVISOR_IMPORT_ONLY = 'true';
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  spawned.length = 0;
  //? Fresh module state (current child, timers) for every case.
  vi.resetModules();
  supervisor = await import('./supervisor');
});

describe('crash restart racing a watcher restart', () => {
  it('starts exactly one replacement child', async () => {
    supervisor.startChild();
    expect(spawned).toHaveLength(1);

    //? Crash: a restart is now pending on the crash delay.
    spawned[0]?.emit('exit', 1, null);
    //? A watched file is saved inside that delay.
    supervisor.scheduleRestart({ event: 'change', changedPath: 'config.ts' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(spawned).toHaveLength(2);
  });
});

describe('restart requested by the dev server', () => {
  it('opens an IPC channel to the child', async () => {
    const { spawn } = await import('node:child_process');
    supervisor.startChild();
    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2];
    expect(options?.stdio).toContain('ipc');
  });

  it('restarts the child on a restart message', async () => {
    supervisor.startChild();
    const child = spawned[0];

    child?.emit('message', { type: DEV_RESTART_MESSAGE_TYPE, reason: '/app/src/chat/helpers.ts' });
    await vi.advanceTimersByTimeAsync(500);
    expect(child?.kill).toHaveBeenCalledWith('SIGTERM');

    child?.emit('exit', 0, null);
    expect(spawned).toHaveLength(2);
  });

  it('ignores unrelated messages and messages from a replaced child', async () => {
    supervisor.startChild();
    const first = spawned[0];
    first?.emit('message', { type: 'something-else' });
    await vi.advanceTimersByTimeAsync(500);
    expect(first?.kill).not.toHaveBeenCalled();

    //? Replace the first child via a watcher restart.
    supervisor.scheduleRestart({ event: 'change', changedPath: 'config.ts' });
    await vi.advanceTimersByTimeAsync(500);
    first?.emit('exit', 0, null);
    const second = spawned[1];
    expect(second).toBeDefined();

    first?.emit('message', { type: DEV_RESTART_MESSAGE_TYPE, reason: 'late' });
    await vi.advanceTimersByTimeAsync(500);
    expect(second?.kill).not.toHaveBeenCalled();
  });
});
