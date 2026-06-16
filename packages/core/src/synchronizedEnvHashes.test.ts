import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

import { registerProjectConfig, getProjectConfig } from './projectConfig';
import { registerDeployConfig } from './deployConfigRegistry';
import {
  computeSynchronizedEnvHashes,
  hashSynchronizedValue,
  hashSynchronizedValueWith,
  resolveHealthHashConfig,
  describeHealthHashConfig,
  resolveHealthHashConfigFromDescriptor,
} from './synchronizedEnvHashes';

const SECRET_ENV = 'TEST_SYNC_SECRET';

beforeEach(() => {
  registerProjectConfig({});
  registerDeployConfig({
    resources: {
      redisMain: { type: 'redis', urlEnvKey: 'REDIS_URL', synchronizedEnvKeys: [SECRET_ENV] },
    },
  });
  process.env[SECRET_ENV] = 'super-secret-value';
});

afterEach(() => {
  Reflect.deleteProperty(process.env, SECRET_ENV);
  registerProjectConfig({});
});

describe('health-hash (SEC-13) — 0.2.0 secure default = hmac keyed on @bootUuid', () => {
  it('default config resolves to hmac + @bootUuid sentinel', () => {
    registerProjectConfig({});
    expect(getProjectConfig().http.healthHash).toEqual({ mode: 'hmac', salt: '@bootUuid' });
  });

  it('default HMAC-keys the synchronized fingerprint on the supplied boot UUID (rotates per restart)', () => {
    const expected = createHmac('sha256', 'boot-xyz').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes('boot-xyz')[SECRET_ENV]).toBe(expected);
    // Router computes the same value with the shared helper given the same boot UUID.
    expect(hashSynchronizedValue('super-secret-value', 'boot-xyz')).toBe(expected);
    // The per-boot key means a different boot UUID yields a different fingerprint.
    expect(computeSynchronizedEnvHashes('boot-abc')[SECRET_ENV]).not.toBe(expected);
  });

  it('collapses to plain sha256 when no boot UUID is available (boot handshake never silently diverges)', () => {
    const plain = createHash('sha256').update('super-secret-value').digest('hex');
    expect(resolveHealthHashConfig()).toEqual({ mode: 'plain', salt: '' });
    expect(computeSynchronizedEnvHashes()[SECRET_ENV]).toBe(plain);
    expect(hashSynchronizedValue('super-secret-value')).toBe(plain);
  });

  it('maps an undefined synchronized env var to null', () => {
    Reflect.deleteProperty(process.env, SECRET_ENV);
    expect(computeSynchronizedEnvHashes('boot-xyz')[SECRET_ENV]).toBeNull();
  });
});

describe('health-hash (SEC-13) — salted / hmac opt-in', () => {
  it('salted mode hashes salt + value (server and router agree given same salt)', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'salted', salt: 'pepper' } } });
    const expected = createHash('sha256').update('pepper').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes()[SECRET_ENV]).toBe(expected);
    // The router computes the same value with the shared helper.
    expect(hashSynchronizedValueWith({ mode: 'salted', salt: 'pepper' }, 'super-secret-value')).toBe(expected);
  });

  it('hmac mode uses HMAC-SHA256 with the shared salt as key', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'hmac', salt: 'shared-key' } } });
    const expected = createHmac('sha256', 'shared-key').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes()[SECRET_ENV]).toBe(expected);
  });

  it('@bootUuid salt resolves to the supplied boot UUID under salted mode', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'salted', salt: '@bootUuid' } } });
    expect(resolveHealthHashConfig('boot-123')).toEqual({ mode: 'salted', salt: 'boot-123' });
    const expected = createHash('sha256').update('boot-123').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes('boot-123')[SECRET_ENV]).toBe(expected);
  });

  it('@bootUuid salt resolves to the supplied boot UUID under hmac mode (0.2.0 default)', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'hmac', salt: '@bootUuid' } } });
    expect(resolveHealthHashConfig('boot-123')).toEqual({ mode: 'hmac', salt: 'boot-123' });
    const expected = createHmac('sha256', 'boot-123').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes('boot-123')[SECRET_ENV]).toBe(expected);
  });

  it('@bootUuid salt collapses to plain when no boot UUID is available (never silently diverge)', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'salted', salt: '@bootUuid' } } });
    expect(resolveHealthHashConfig()).toEqual({ mode: 'plain', salt: '' });
    const plain = createHash('sha256').update('super-secret-value').digest('hex');
    expect(computeSynchronizedEnvHashes()[SECRET_ENV]).toBe(plain);
  });

  it('salted/hmac with an empty resolved salt falls back to plain rather than hashing with an empty key', () => {
    expect(hashSynchronizedValueWith({ mode: 'hmac', salt: '' }, 'x')).toBe(
      createHash('sha256').update('x').digest('hex'),
    );
  });
});

//? WAVE4: the router process never loads the backend's config.ts, so it must hash
//? with the config the BACKEND reports in /_health — not its own default. The
//? descriptor never carries a static salt (a secret), so a static-salt backend is
//? explicitly unverifiable rather than producing a false drift.
describe('health-hash descriptor (WAVE4 cross-process router compare)', () => {
  it('describeHealthHashConfig exposes mode + bootUuidSalt, never a static salt', () => {
    registerProjectConfig({ http: { healthHash: { mode: 'hmac', salt: '@bootUuid' } } });
    expect(describeHealthHashConfig()).toEqual({ mode: 'hmac', bootUuidSalt: true });

    registerProjectConfig({ http: { healthHash: { mode: 'hmac', salt: 'super-secret-key' } } });
    const d = describeHealthHashConfig();
    expect(d).toEqual({ mode: 'hmac', bootUuidSalt: false });
    expect(JSON.stringify(d)).not.toContain('super-secret-key');

    registerProjectConfig({ http: { healthHash: { mode: 'plain', salt: '' } } });
    expect(describeHealthHashConfig()).toEqual({ mode: 'plain', bootUuidSalt: false });
  });

  it('router reproduces the backend hash for default (@bootUuid) config from the descriptor + bootUuid', () => {
    const descriptor = { mode: 'hmac' as const, bootUuidSalt: true };
    const cfg = resolveHealthHashConfigFromDescriptor(descriptor, 'boot-xyz');
    expect(cfg).toEqual({ mode: 'hmac', salt: 'boot-xyz' });
    const expected = createHmac('sha256', 'boot-xyz').update('super-secret-value').digest('hex');
    expect(hashSynchronizedValueWith(cfg!, 'super-secret-value')).toBe(expected);
    // ...and this is exactly what the backend /_health produced.
    registerProjectConfig({ http: { healthHash: { mode: 'hmac', salt: '@bootUuid' } } });
    expect(computeSynchronizedEnvHashes('boot-xyz')[SECRET_ENV]).toBe(expected);
  });

  it('router reproduces a plain backend hash from the descriptor', () => {
    const cfg = resolveHealthHashConfigFromDescriptor({ mode: 'plain', bootUuidSalt: false }, 'boot-xyz');
    expect(cfg).toEqual({ mode: 'plain', salt: '' });
  });

  it('returns null for a static salt the router cannot see (caller must skip, not report drift)', () => {
    expect(resolveHealthHashConfigFromDescriptor({ mode: 'hmac', bootUuidSalt: false }, 'boot-xyz')).toBeNull();
    expect(resolveHealthHashConfigFromDescriptor({ mode: 'salted', bootUuidSalt: false }, 'boot-xyz')).toBeNull();
  });
});
