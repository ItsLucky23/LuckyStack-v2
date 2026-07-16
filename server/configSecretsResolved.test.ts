import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

//? REGRESSION for finding C-04 — against THIS PROJECT'S REAL `config.ts`, not a
//? miniature of it. `packages/core/src/secretsResolvedConfig.test.ts` pins the
//? mechanism; this pins that config.ts actually USES it. Both are needed: the
//? mechanism test passes happily even if someone deletes the listener from
//? config.ts, which is the failure this file exists to catch.
//?
//? THE BUG (measured live 2026-07-16, before the fix):
//?   server.ts imports ../config at :17 and awaits resolveSecretsIfConfigured()
//?   at :52. So config.ts read env 35 lines too early, and a secret-manager
//?   pointer froze into the config forever:
//?     projectConfig.email.from  -> "EMAIL_FROM_BASE_V1"  (sender = a pointer)
//?     http.cors.allowedOrigins  -> ["ORIGINS_BASE_V1"]   (CORS fails CLOSED)
//?   ...while process.env already held the resolved values.

const ENV_KEYS = ['EMAIL_FROM', 'EXTERNAL_ORIGINS', 'DNS', 'SERVER_PORT'] as const;
const saved: Record<string, string | undefined> = {};

//? Import core BEFORE stubbing anything. Importing it runs `env.ts`, whose dotenv
//? pass loads `.env` and then `.env.local` with `override: true` — so a value
//? stubbed first is silently REPLACED by whatever the developer's real
//? `.env.local` happens to contain. That is not hypothetical: the first cut of
//? this test stubbed first and got `noreply@resend.dev` from a real .env.local,
//? which looks exactly like the fix failing. Load the env files, THEN stub, and
//? the ordering under test is the only variable left.
const loadCoreThenStub = async (values: Record<string, string>): Promise<void> => {
  await import('@luckystack/core');
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  //? config.ts registers on import; each test needs a fresh module graph or the
  //? second one silently asserts against the first one's registration.
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = saved[key];
    if (original === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = original;
  }
});

describe('config.ts survives late secret resolution (C-04)', () => {
  it('refreshes every env-derived URL without resetting unrelated project policy', async () => {
    await loadCoreThenStub({
      EMAIL_FROM: 'EMAIL_FROM_BASE_V1',
      EXTERNAL_ORIGINS: 'ORIGINS_BASE_V1',
      DNS: 'DNS_BASE_V1',
      SERVER_PORT: '80',
    });

    //? server.ts:17 — config.ts evaluates now, against the POINTER values above.
    const configModule = await import('../config');
    const projectConfig = configModule.default;
    const { getProjectConfig, notifySecretsResolved } = await import('@luckystack/core');

    //? Sanity: the pointers really were what config.ts saw. Without this the test
    //? could pass against a config that never read the env at all.
    expect(projectConfig.email.from).toBe('EMAIL_FROM_BASE_V1');
    expect(getProjectConfig().http.cors.allowedOrigins).toEqual(['DNS_BASE_V1', 'ORIGINS_BASE_V1']);
    expect(getProjectConfig().rateLimiting.store).toBe('redis');
    expect(getProjectConfig().auth.forgotPassword).toBe('framework');

    //? server.ts:52 — the resolver overwrites process.env and fires the channel.
    process.env.EMAIL_FROM = 'real-sender@company.com';
    process.env.EXTERNAL_ORIGINS = 'https://external.company.com';
    process.env.DNS = 'https://app.server.com,https://secondary.company.com';
    notifySecretsResolved(['EMAIL_FROM', 'EXTERNAL_ORIGINS', 'DNS']);

    //? server.ts:55 + :73 read `projectConfig.email.from` — both AFTER the resolve.
    expect(
      projectConfig.email.from,
      'the email sender would send from an unresolved secret-manager pointer',
    ).toBe('real-sender@company.com');

    //? The framework's `allowedOrigin()` reads this at request time.
    const refreshed = getProjectConfig();
    expect(
      refreshed.http.cors.allowedOrigins,
      'CORS would reject the origin the operator actually configured',
    ).toEqual([
      'https://app.server.com',
      'https://secondary.company.com',
      'https://external.company.com',
    ]);
    expect(refreshed.app.publicUrl).toBe('https://app.server.com');
    expect(refreshed.oauthCallbackBase).toBe('https://app.server.com');
    expect(refreshed.http.cors.allowLocalhost).toBe(false);
    expect(refreshed.session.perUser).toBe('single');

    //? Replacement registrations start from defaults. These assertions catch a
    //? CORS-only partial silently wiping the rest of the consumer's policy.
    expect(refreshed.rateLimiting.store).toBe('redis');
    expect(refreshed.auth.forgotPassword).toBe('framework');
    expect(refreshed.socketActivityBroadcaster).toBe(true);
    expect(refreshed.loginRedirectUrl).toBe('/playground');
  });

  it('leaves the import-time values alone when no secret manager ever fires', async () => {
    //? The common case: no secret manager, so `notifySecretsResolved` is never
    //? called and the import-time read was already final. The fix must not depend
    //? on the listener firing to produce a correct config.
    await loadCoreThenStub({
      EMAIL_FROM: 'plain@example.com',
      EXTERNAL_ORIGINS: 'https://plain.example.com',
      DNS: '',
    });

    const configModule = await import('../config');
    const { getProjectConfig } = await import('@luckystack/core');

    expect(configModule.default.email.from).toBe('plain@example.com');
    expect(getProjectConfig().http.cors.allowedOrigins).toEqual(['https://plain.example.com']);
  });
});
