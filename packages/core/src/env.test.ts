import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_ENV_FILES, getEnvFiles } from './env';

describe('getEnvFiles', () => {
  const original = process.env.LUCKYSTACK_ENV_FILES;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LUCKYSTACK_ENV_FILES;
    } else {
      process.env.LUCKYSTACK_ENV_FILES = original;
    }
  });

  it('defaults to .env then .env.local', () => {
    delete process.env.LUCKYSTACK_ENV_FILES;
    expect(getEnvFiles()).toEqual(['.env', '.env.local']);
    expect(DEFAULT_ENV_FILES).toEqual(['.env', '.env.local']);
  });

  it('honors a comma-separated LUCKYSTACK_ENV_FILES override (trimmed, order preserved)', () => {
    process.env.LUCKYSTACK_ENV_FILES = '.env, .env.staging ,.env.local';
    expect(getEnvFiles()).toEqual(['.env', '.env.staging', '.env.local']);
  });

  it('falls back to the default when the override is blank', () => {
    process.env.LUCKYSTACK_ENV_FILES = '   ,  ';
    expect(getEnvFiles()).toEqual(['.env', '.env.local']);
  });
});
