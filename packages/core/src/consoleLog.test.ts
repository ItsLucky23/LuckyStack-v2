import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initConsolelog } from './consoleLog';

describe('initConsolelog', () => {
  const realLog = console.log;
  let nativeLog: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    //? `initConsolelog` captures whatever `console.log` is at install time as
    //? the native sink, so install over a spy.
    nativeLog = vi.fn<(...args: unknown[]) => void>();
    console.log = nativeLog;
    initConsolelog();
  });

  afterEach(() => {
    console.log = realLog;
  });

  it('passes objects after a leading string to the native log unchanged', () => {
    const user = { id: 'u1' };
    console.log('user loaded', user);

    expect(nativeLog).toHaveBeenCalledTimes(1);
    const [label, ...rest] = nativeLog.mock.calls[0] ?? [];
    expect(String(label)).toContain('consoleLog.test.ts -- user loaded');
    expect(String(label)).not.toContain('[object Object]');
    expect(rest).toEqual([user]);
  });

  it('keeps an error argument intact so its stack is printed', () => {
    const error = new Error('boom');
    console.log('failed', error);

    const [, ...rest] = nativeLog.mock.calls[0] ?? [];
    expect(rest).toEqual([error]);
  });

  it('joins the leading strings and still strips a trailing colour name', () => {
    console.log('one', 'two', { x: 1 }, 'red');

    const [label, ...rest] = nativeLog.mock.calls[0] ?? [];
    expect(String(label)).toContain('\u001B[31m');
    expect(String(label)).toContain('-- one two');
    expect(rest).toEqual([{ x: 1 }]);
  });

  it('prints an all-string call as one coloured line', () => {
    console.log('plain', 'text');

    expect(nativeLog.mock.calls[0]).toHaveLength(1);
    expect(String(nativeLog.mock.calls[0]?.[0])).toContain('-- plain text');
  });
});
