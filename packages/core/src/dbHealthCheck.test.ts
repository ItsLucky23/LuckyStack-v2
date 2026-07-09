import { afterEach, describe, expect, it } from 'vitest';
import {
  getDbHealthCheck,
  isDbHealthCheckRegistered,
  registerDbHealthCheck,
  resetDbHealthCheckForTests,
} from './dbHealthCheck';
import { isPrismaClientResolvable } from './db';

afterEach(() => {
  resetDbHealthCheckForTests();
});

describe('dbHealthCheck registry', () => {
  it('is empty by default', () => {
    expect(isDbHealthCheckRegistered()).toBe(false);
    expect(getDbHealthCheck()).toBeNull();
  });

  it('returns the registered probe (sync or async, boolean or skipped)', async () => {
    registerDbHealthCheck(() => 'skipped');
    expect(isDbHealthCheckRegistered()).toBe(true);
    expect(getDbHealthCheck()?.()).toBe('skipped');

    registerDbHealthCheck(async () => true);
    await expect(getDbHealthCheck()?.()).resolves.toBe(true);
  });

  it('reset drops the registration', () => {
    registerDbHealthCheck(() => true);
    resetDbHealthCheckForTests();
    expect(getDbHealthCheck()).toBeNull();
  });
});

describe('isPrismaClientResolvable', () => {
  it('is true in the framework repo (@prisma/client installed)', () => {
    expect(isPrismaClientResolvable()).toBe(true);
  });
});
