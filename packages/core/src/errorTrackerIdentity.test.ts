import { describe, expect, it } from 'vitest';
import {
  getCurrentErrorTrackerIdentity,
  runWithErrorTrackerIdentity,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
} from './errorTrackerIdentity';

const noop = (): void => undefined;

describe('error-tracker AsyncLocalStorage identity', () => {
  it('is null outside a request scope', () => {
    expect(getCurrentErrorTrackerIdentity()).toBeNull();
    setCurrentErrorTrackerIdentity({ id: 'ignored' });
    expect(getCurrentErrorTrackerIdentity()).toBeNull();
  });

  it('supports late session assignment across an async boundary', async () => {
    await runWithErrorTrackerIdentityScope(async () => {
      expect(getCurrentErrorTrackerIdentity()).toBeNull();
      await Promise.resolve();
      setCurrentErrorTrackerIdentity({ id: 'user-1', email: 'user@example.com' });
      await Promise.resolve();
      expect(getCurrentErrorTrackerIdentity()).toEqual({
        id: 'user-1',
        email: 'user@example.com',
      });
    });
    expect(getCurrentErrorTrackerIdentity()).toBeNull();
  });

  it('isolates identities across interleaved async request scopes', async () => {
    let releaseFirst = noop;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runWithErrorTrackerIdentityScope(async () => {
      setCurrentErrorTrackerIdentity({ id: 'first' });
      await firstCanFinish;
      expect(getCurrentErrorTrackerIdentity()?.id).toBe('first');
    });
    runWithErrorTrackerIdentityScope(() => {
      setCurrentErrorTrackerIdentity({ id: 'second' });
      expect(getCurrentErrorTrackerIdentity()?.id).toBe('second');
      releaseFirst();
    });

    await first;
    expect(getCurrentErrorTrackerIdentity()).toBeNull();
  });

  it('restores the parent identity after a nested scope', () => {
    runWithErrorTrackerIdentity({ id: 'parent' }, () => {
      expect(getCurrentErrorTrackerIdentity()?.id).toBe('parent');
      runWithErrorTrackerIdentity({ id: 'child' }, () => {
        expect(getCurrentErrorTrackerIdentity()?.id).toBe('child');
      });
      expect(getCurrentErrorTrackerIdentity()?.id).toBe('parent');
    });
  });
});
