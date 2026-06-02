import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  DEFAULT_PROJECT_CONFIG,
  getProjectConfig,
  getProjectName,
  isProjectConfigRegistered,
  registerProjectConfig,
} from './projectConfig';

describe('registerProjectConfig + getProjectConfig', () => {
  beforeEach(() => {
    //? Re-registering with {} rebuilds activeConfig from DEFAULT_PROJECT_CONFIG,
    //? isolating each test from prior overrides (no dedicated reset helper exists).
    registerProjectConfig({});
  });

  it('returns the defaults when registered with an empty override', () => {
    const config = getProjectConfig();
    expect(config.rateLimiting.defaultApiLimit).toBe(60);
    expect(config.http.sessionCookieName).toBe('token');
    expect(config.defaultLanguage).toBe('en');
  });

  it('deep-merges a partial override without clobbering sibling keys', () => {
    registerProjectConfig({ rateLimiting: { defaultApiLimit: 10 } });
    const config = getProjectConfig();
    expect(config.rateLimiting.defaultApiLimit).toBe(10);
    // Siblings inside rateLimiting keep their defaults.
    expect(config.rateLimiting.defaultIpLimit).toBe(100);
    expect(config.rateLimiting.store).toBe('memory');
    // Unrelated top-level sections keep their defaults.
    expect(config.http.sessionCookieName).toBe('token');
  });

  it('replaces array values wholesale rather than merging them', () => {
    registerProjectConfig({ http: { cors: { allowedOrigins: ['https://a.example.com'] } } });
    const config = getProjectConfig();
    expect(config.http.cors.allowedOrigins).toEqual(['https://a.example.com']);
  });

  it('marks the config as registered', () => {
    registerProjectConfig({});
    expect(isProjectConfigRegistered()).toBe(true);
  });

  it('exposes DEFAULT_PROJECT_CONFIG with the documented defaults', () => {
    expect(DEFAULT_PROJECT_CONFIG.session.expiryDays).toBe(7);
    expect(DEFAULT_PROJECT_CONFIG.auth.bcryptRounds).toBe(10);
    expect(DEFAULT_PROJECT_CONFIG.offlineQueue.dropPolicy).toBe('drop-oldest');
  });
});

describe('getProjectName', () => {
  const originalProjectName = process.env.PROJECT_NAME;

  beforeEach(() => {
    registerProjectConfig({});
  });

  afterEach(() => {
    if (originalProjectName === undefined) {
      delete process.env.PROJECT_NAME;
    } else {
      process.env.PROJECT_NAME = originalProjectName;
    }
  });

  it('prefers an explicit session.projectName from config', () => {
    process.env.PROJECT_NAME = 'env-name';
    registerProjectConfig({ session: { projectName: 'config-name' } });
    expect(getProjectName()).toBe('config-name');
  });

  it('falls back to process.env.PROJECT_NAME when config name is empty', () => {
    process.env.PROJECT_NAME = 'env-name';
    // Default session.projectName is '' so the env value wins.
    expect(getProjectName()).toBe('env-name');
  });

  it('falls back to the literal "luckystack" when neither config nor env is set', () => {
    delete process.env.PROJECT_NAME;
    expect(getProjectName()).toBe('luckystack');
  });
});
