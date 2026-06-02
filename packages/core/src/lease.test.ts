import { afterEach, describe, expect, it, vi } from 'vitest';

//? Unit-test the lease logic against a mocked redis proxy (no real Redis). The
//? net-prefixing + real key bytes are covered by redisKeyFormatter.test.ts; the
//? end-to-end Redis path is covered by the live test-runner sweep.
const setMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const evalMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('./redis', () => ({
  redis: {
    set: (...args: unknown[]) => setMock(...args),
    eval: (...args: unknown[]) => evalMock(...args),
  },
}));

import { acquireLease, releaseLease, renewLease } from './lease';
import { formatKey } from './redisKeyFormatter';

const KEY = formatKey('lease', 'indexer');

describe('lease primitive', () => {
  afterEach(() => {
    setMock.mockReset();
    evalMock.mockReset();
  });

  describe('acquireLease', () => {
    it('returns an owner token and writes SET … PX … NX when the lease is free', async () => {
      setMock.mockResolvedValue('OK');
      const token = await acquireLease('indexer', 30_000);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(setMock).toHaveBeenCalledWith(KEY, token, 'PX', 30_000, 'NX');
    });

    it('returns null when the lease is already held (SET NX returns null)', async () => {
      setMock.mockResolvedValue(null);
      expect(await acquireLease('indexer', 30_000)).toBeNull();
    });

    it('returns null (never throws) when Redis errors', async () => {
      setMock.mockRejectedValue(new Error('redis down'));
      expect(await acquireLease('indexer', 30_000)).toBeNull();
    });
  });

  describe('renewLease', () => {
    it('returns true and runs the owner-checked Lua when the token matches', async () => {
      evalMock.mockResolvedValue(1);
      const ok = await renewLease('indexer', 'tok', 30_000);
      expect(ok).toBe(true);
      expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, KEY, 'tok', '30000');
    });

    it('returns false when the token does not own the lease (Lua returns 0)', async () => {
      evalMock.mockResolvedValue(0);
      expect(await renewLease('indexer', 'wrong', 30_000)).toBe(false);
    });

    it('returns false when Redis errors', async () => {
      evalMock.mockRejectedValue(new Error('redis down'));
      expect(await renewLease('indexer', 'tok', 30_000)).toBe(false);
    });
  });

  describe('releaseLease', () => {
    it('returns true and deletes when the token owns the lease', async () => {
      evalMock.mockResolvedValue(1);
      const ok = await releaseLease('indexer', 'tok');
      expect(ok).toBe(true);
      expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, KEY, 'tok');
    });

    it('returns false when the token does not own the lease', async () => {
      evalMock.mockResolvedValue(0);
      expect(await releaseLease('indexer', 'wrong')).toBe(false);
    });
  });
});
