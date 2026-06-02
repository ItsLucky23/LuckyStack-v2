import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerEmailConfig,
  getEmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from './emailConfig';

//? `registerEmailConfig` deep-merges over `DEFAULT_EMAIL_CONFIG` and stores the
//? result in module-level state read by `getEmailConfig`. There is no public
//? reset seam, so each test re-registers a full or partial config first to
//? establish a known baseline. Registering `{}` restores the default snapshot.

describe('email config registry', () => {
  beforeEach(() => {
    // Reset to a clean default by deep-merging an empty override.
    registerEmailConfig({});
  });

  it('returns the default config before (and after a no-op) override', () => {
    expect(getEmailConfig()).toEqual(DEFAULT_EMAIL_CONFIG);
  });

  it('exposes the documented default values', () => {
    expect(DEFAULT_EMAIL_CONFIG.from).toBe('noreply@example.com');
    expect(DEFAULT_EMAIL_CONFIG.required).toBe(false);
    expect(DEFAULT_EMAIL_CONFIG.logging).toEqual({ errors: true, sends: false });
    expect(DEFAULT_EMAIL_CONFIG.envVars.resendApiKey).toBe('RESEND_API_KEY');
    expect(DEFAULT_EMAIL_CONFIG.envVars.smtpHost).toBe('SMTP_HOST');
    expect(DEFAULT_EMAIL_CONFIG.defaults.smtpPort).toBe(587);
  });

  it('overrides a top-level scalar while preserving every other default', () => {
    registerEmailConfig({ from: 'hi@acme.test', required: true });
    const config = getEmailConfig();
    expect(config.from).toBe('hi@acme.test');
    expect(config.required).toBe(true);
    // Untouched nested groups remain at defaults.
    expect(config.logging).toEqual(DEFAULT_EMAIL_CONFIG.logging);
    expect(config.envVars).toEqual(DEFAULT_EMAIL_CONFIG.envVars);
    expect(config.defaults).toEqual(DEFAULT_EMAIL_CONFIG.defaults);
  });

  it('deep-merges a nested group, keeping sibling keys from the default', () => {
    registerEmailConfig({ logging: { sends: true } });
    const config = getEmailConfig();
    expect(config.logging.sends).toBe(true);
    // `errors` was not overridden, so the default survives the merge.
    expect(config.logging.errors).toBe(true);
  });

  it('renames only the env vars provided, leaving the rest at defaults', () => {
    registerEmailConfig({ envVars: { resendApiKey: 'MY_APP_RESEND', smtpHost: 'MY_APP_SMTP' } });
    const config = getEmailConfig();
    expect(config.envVars.resendApiKey).toBe('MY_APP_RESEND');
    expect(config.envVars.smtpHost).toBe('MY_APP_SMTP');
    // Non-overridden env-var names keep the framework defaults.
    expect(config.envVars.smtpPort).toBe('SMTP_PORT');
    expect(config.envVars.emailFrom).toBe('EMAIL_FROM');
  });

  it('overrides nested numeric defaults', () => {
    registerEmailConfig({ defaults: { smtpPort: 2525 } });
    expect(getEmailConfig().defaults.smtpPort).toBe(2525);
  });

  it('does not mutate the shared DEFAULT_EMAIL_CONFIG object when merging', () => {
    registerEmailConfig({ logging: { sends: true }, from: 'x@y.test' });
    // The exported default must remain pristine for later callers.
    expect(DEFAULT_EMAIL_CONFIG.logging.sends).toBe(false);
    expect(DEFAULT_EMAIL_CONFIG.from).toBe('noreply@example.com');
  });

  it('ignores undefined override values and keeps the underlying default', () => {
    registerEmailConfig({ from: undefined, required: true });
    const config = getEmailConfig();
    // `from: undefined` is skipped by the merge, so the default stands.
    expect(config.from).toBe('noreply@example.com');
    expect(config.required).toBe(true);
  });
});
