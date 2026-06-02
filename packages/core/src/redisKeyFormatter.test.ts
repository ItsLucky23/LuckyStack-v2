import { afterEach, describe, expect, it } from 'vitest';
import { getProjectName } from './projectConfig';
import {
  applyStrayKeyPrefix,
  defaultRedisKeyFormatter,
  formatKey,
  getRedisKeyFormatter,
  registerRedisKeyFormatter,
  resetRedisKeyFormatterForTests,
} from './redisKeyFormatter';

//? Expected strings are built from the live `getProjectName()` so the suite is
//? robust to whatever project name the ambient config resolves to.
const project = (): string => getProjectName();

describe('redis key formatter', () => {
  afterEach(() => {
    resetRedisKeyFormatterForTests();
  });

  describe('default formatter — legacy byte preservation (zero migration)', () => {
    it('reproduces the historical session / activeUsers / token shapes (dash namespaces)', () => {
      expect(formatKey('-session', 'abc')).toBe(`${project()}-session:abc`);
      expect(formatKey('-activeUsers', 'u1')).toBe(`${project()}-activeUsers:u1`);
      expect(formatKey('-pwreset', 'tok')).toBe(`${project()}-pwreset:tok`);
      expect(formatKey('-email-change', 'tok')).toBe(`${project()}-email-change:tok`);
      expect(formatKey('-oauth-state', 'google:state123')).toBe(`${project()}-oauth-state:google:state123`);
    });

    it('reproduces the rate-limit colon scheme', () => {
      expect(formatKey(':rate-limit', '')).toBe(`${project()}:rate-limit`);
      expect(formatKey(':rate-limit', 'user:5')).toBe(`${project()}:rate-limit:user:5`);
    });

    it('an empty suffix yields just the namespace root (used to derive SCAN patterns)', () => {
      expect(formatKey('-session', '')).toBe(`${project()}-session`);
      expect(`${formatKey('-session', '')}:*`).toBe(`${project()}-session:*`);
    });

    it('colon-joins a plain namespace for clean app keys', () => {
      expect(formatKey('rag', 'ticket-42')).toBe(`${project()}:rag:ticket-42`);
      expect(formatKey('cache')).toBe(`${project()}:cache`);
    });

    it('defaultRedisKeyFormatter is the active formatter until one is registered', () => {
      expect(getRedisKeyFormatter()).toBe(defaultRedisKeyFormatter);
    });
  });

  describe('registerRedisKeyFormatter — tenant-aware override', () => {
    it('routes every formatKey call through the registered formatter', () => {
      registerRedisKeyFormatter((namespace, suffix) => `tenant42::${namespace}::${suffix}`);
      expect(getRedisKeyFormatter()).not.toBe(defaultRedisKeyFormatter);
      expect(formatKey('-session', 'abc')).toBe('tenant42::-session::abc');
    });

    it('reset restores the default formatter', () => {
      registerRedisKeyFormatter(() => 'custom');
      resetRedisKeyFormatterForTests();
      expect(getRedisKeyFormatter()).toBe(defaultRedisKeyFormatter);
      expect(formatKey('-session', 'abc')).toBe(`${project()}-session:abc`);
    });
  });

  describe('applyStrayKeyPrefix — best-effort net', () => {
    it('prefixes an un-namespaced (colon-free) key', () => {
      expect(applyStrayKeyPrefix('counter')).toBe(`${project()}:counter`);
    });

    it('leaves any already-namespaced key (contains ":") untouched — never double-prefixes', () => {
      expect(applyStrayKeyPrefix('cache:user:5')).toBe('cache:user:5');
      expect(applyStrayKeyPrefix(`${project()}-session:abc`)).toBe(`${project()}-session:abc`);
      expect(applyStrayKeyPrefix('luckystack:boot:development')).toBe('luckystack:boot:development');
    });
  });
});
