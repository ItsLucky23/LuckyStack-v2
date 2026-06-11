import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerPresenceConfig,
  getPresenceConfig,
  DEFAULT_PRESENCE_CONFIG,
} from './presenceConfig';

//? `registerPresenceConfig` deep-merges its input over DEFAULT_PRESENCE_CONFIG
//? and stores it in module-level mutable state read by `getPresenceConfig()`.
//? State persists across tests, so each test re-registers from a known base.
//? We reset to the documented defaults in beforeEach by registering an empty
//? override (which deep-merges to a fresh copy of DEFAULT_PRESENCE_CONFIG).

describe('presenceConfig', () => {
  beforeEach(() => {
    registerPresenceConfig({});
  });

  describe('DEFAULT_PRESENCE_CONFIG', () => {
    it('matches the documented default values', () => {
      expect(DEFAULT_PRESENCE_CONFIG).toEqual({
        disconnectTimers: {
          tabSwitchMs: 20_000,
          transportCloseMs: 60_000,
          defaultMs: 2000,
        },
        ignoreReasons: ['ping timeout'],
        allowReasons: ['transport close', 'transport error'],
        afkTimeoutMs: 5 * 60_000,
        activitySampleIntervalMs: 15_000,
      });
    });
  });

  describe('getPresenceConfig', () => {
    it('returns the defaults after an empty override', () => {
      expect(getPresenceConfig()).toEqual(DEFAULT_PRESENCE_CONFIG);
    });

    it('reads the active config at call time (lazy)', () => {
      registerPresenceConfig({ afkTimeoutMs: 1234 });
      expect(getPresenceConfig().afkTimeoutMs).toBe(1234);
      registerPresenceConfig({ afkTimeoutMs: 5678 });
      expect(getPresenceConfig().afkTimeoutMs).toBe(5678);
    });
  });

  describe('registerPresenceConfig deep-merge', () => {
    it('overrides a single top-level scalar while keeping the rest of the defaults', () => {
      registerPresenceConfig({ afkTimeoutMs: 0 });
      const config = getPresenceConfig();
      expect(config.afkTimeoutMs).toBe(0);
      expect(config.disconnectTimers).toEqual(DEFAULT_PRESENCE_CONFIG.disconnectTimers);
      expect(config.ignoreReasons).toEqual(DEFAULT_PRESENCE_CONFIG.ignoreReasons);
      expect(config.allowReasons).toEqual(DEFAULT_PRESENCE_CONFIG.allowReasons);
    });

    it('deep-merges a partial nested object, preserving unspecified nested keys', () => {
      registerPresenceConfig({ disconnectTimers: { tabSwitchMs: 999 } });
      const config = getPresenceConfig();
      expect(config.disconnectTimers).toEqual({
        tabSwitchMs: 999,
        transportCloseMs: 60_000,
        defaultMs: 2000,
      });
    });

    it('replaces an array wholesale rather than concatenating it', () => {
      //? Arrays are not plain objects, so deepMerge takes the override value
      //? directly instead of recursing key-by-key.
      registerPresenceConfig({ ignoreReasons: ['custom reason'] });
      const config = getPresenceConfig();
      expect(config.ignoreReasons).toEqual(['custom reason']);
      expect(config.ignoreReasons).not.toContain('ping timeout');
    });

    it('ignores explicitly-undefined override fields, falling back to the base', () => {
      registerPresenceConfig({ afkTimeoutMs: undefined });
      expect(getPresenceConfig().afkTimeoutMs).toBe(DEFAULT_PRESENCE_CONFIG.afkTimeoutMs);
    });

    it('ignores an explicitly-undefined nested field', () => {
      registerPresenceConfig({ disconnectTimers: { defaultMs: undefined } });
      expect(getPresenceConfig().disconnectTimers.defaultMs).toBe(2000);
    });

    it('merges multiple nested keys at once', () => {
      registerPresenceConfig({
        disconnectTimers: { tabSwitchMs: 10, transportCloseMs: 20 },
      });
      const config = getPresenceConfig();
      expect(config.disconnectTimers.tabSwitchMs).toBe(10);
      expect(config.disconnectTimers.transportCloseMs).toBe(20);
      expect(config.disconnectTimers.defaultMs).toBe(2000);
    });

    it('does not mutate DEFAULT_PRESENCE_CONFIG when overriding nested values', () => {
      registerPresenceConfig({ disconnectTimers: { tabSwitchMs: 1 } });
      expect(DEFAULT_PRESENCE_CONFIG.disconnectTimers.tabSwitchMs).toBe(20_000);
    });

    it('produces a fresh top-level config object on each registration', () => {
      //? An empty override is a shallow copy of the base: the top-level object
      //? differs, but unrecursed nested objects (no override key for them) are
      //? shared by reference. That sharing is safe because registration always
      //? clones the top level — callers never mutate the stored config.
      registerPresenceConfig({});
      const config = getPresenceConfig();
      expect(config).not.toBe(DEFAULT_PRESENCE_CONFIG);
    });

    it('clones a nested object when that nested key is overridden', () => {
      registerPresenceConfig({ disconnectTimers: { tabSwitchMs: 5 } });
      const config = getPresenceConfig();
      expect(config.disconnectTimers).not.toBe(DEFAULT_PRESENCE_CONFIG.disconnectTimers);
      expect(DEFAULT_PRESENCE_CONFIG.disconnectTimers.tabSwitchMs).toBe(20_000);
    });
  });
});
