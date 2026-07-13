import { describe, it, expect } from 'vitest';
import tryCatchSync from './tryCatchSync';

describe('tryCatchSync', () => {
  it('returns [null, value] on success', () => {
    const [error, value] = tryCatchSync(() => 42);
    expect(error).toBeNull();
    expect(value).toBe(42);
  });

  it('returns [Error, null] on throw', () => {
    const [error, value] = tryCatchSync(() => { throw new Error('boom'); });
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('boom');
    expect(value).toBeNull();
  });

  //? CORE-2: `P = void` default lets a params-less call pass only the result
  //? type. Before the fix `tryCatchSync<URL>(...)` failed with TS2558. This call
  //? compiling with a SINGLE type argument is the regression guard.
  it('accepts a single type argument (P defaults to void)', () => {
    const [error, url] = tryCatchSync<URL>(() => new URL('https://example.com/path'));
    expect(error).toBeNull();
    expect(url?.hostname).toBe('example.com');
  });
});
