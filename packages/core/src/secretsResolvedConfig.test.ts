import { describe, it, expect, beforeEach } from 'vitest';
import { registerSecretsResolvedListener, notifySecretsResolved } from './secretsResolved';
import { registerProjectConfig, getProjectConfig } from './projectConfig';

//? REGRESSION for finding C-04 (raised 2026-07-02, measured live 2026-07-16).
//?
//? A consumer `config.ts` runs at MODULE LOAD — which is before server.ts awaits
//? `resolveSecretsIfConfigured()`. Anything it derives from env therefore freezes
//? at import, so a secret-manager pointer (`NAME=BASE_V<n>`) is what the config
//? keeps forever. Measured on the real config before the fix:
//? `http.cors.allowedOrigins` held `["ORIGINS_BASE_V1"]` while
//? `process.env.EXTERNAL_ORIGINS` already said `https://real.company.com` — CORS
//? would reject the very origin the operator configured, failing CLOSED with no
//? error anywhere.
//?
//? The remedy is the ADR-0026 channel core already uses for its redis client:
//? re-register the env-derived slots when secrets land. These tests pin the two
//? properties that make that work, because both are easy to break by accident.

const ORIGINS_KEY = 'EXTERNAL_ORIGINS_C04_TEST';

describe('secrets-resolved re-registration (C-04)', () => {
  beforeEach(() => {
    delete process.env[ORIGINS_KEY];
    registerProjectConfig({ http: { cors: { allowedOrigins: [] } } });
  });

  it('a config slot derived from env at import time is refreshed when secrets resolve', () => {
    //? Mirrors what a consumer config.ts does, in miniature.
    const collect = (): string[] => (process.env[ORIGINS_KEY] ?? '').split(',').filter(Boolean);

    process.env[ORIGINS_KEY] = 'ORIGINS_BASE_V1';           // a pointer, pre-resolve
    registerProjectConfig({ http: { cors: { allowedOrigins: collect() } } });
    const unsubscribe = registerSecretsResolvedListener(() => {
      registerProjectConfig({ http: { cors: { allowedOrigins: collect() } } });
    });

    expect(getProjectConfig().http?.cors?.allowedOrigins).toEqual(['ORIGINS_BASE_V1']);

    process.env[ORIGINS_KEY] = 'https://real.company.com';  // the resolver writes the truth
    notifySecretsResolved([ORIGINS_KEY]);

    expect(
      getProjectConfig().http?.cors?.allowedOrigins,
      'the config kept the unresolved pointer — CORS would reject the real origin',
    ).toEqual(['https://real.company.com']);
    unsubscribe();
  });

  it('re-registering an array REPLACES it rather than appending', () => {
    //? Load-bearing: the fix re-registers the whole list. If deepMerge ever
    //? concatenated arrays instead, every resolve would grow the allowlist and a
    //? stale pointer would stay in it forever — a silently widening CORS policy,
    //? which is worse than the bug being fixed.
    registerProjectConfig({ http: { cors: { allowedOrigins: ['https://a.example'] } } });
    registerProjectConfig({ http: { cors: { allowedOrigins: ['https://b.example'] } } });

    expect(getProjectConfig().http?.cors?.allowedOrigins).toEqual(['https://b.example']);
  });

  it('a getter cannot substitute for the listener — registerProjectConfig reads it during the merge', () => {
    //? Documents WHY the fix is a listener and not simply `get allowedOrigins()`.
    //? deepMerge copies the value out of the input object, which invokes the
    //? getter right then — at import — so the result is frozen exactly as before.
    //? Someone will eventually try the getter; this is the proof it does not work.
    let reads = 0;
    process.env[ORIGINS_KEY] = 'ORIGINS_BASE_V1';
    registerProjectConfig({
      http: {
        cors: {
          get allowedOrigins(): string[] {
            reads += 1;
            return (process.env[ORIGINS_KEY] ?? '').split(',').filter(Boolean);
          },
        },
      },
    });

    expect(reads, 'the getter was not evaluated during registration').toBeGreaterThan(0);

    process.env[ORIGINS_KEY] = 'https://real.company.com';
    expect(
      getProjectConfig().http?.cors?.allowedOrigins,
      'a getter survived the merge — if this ever passes, the simpler fix became viable',
    ).toEqual(['ORIGINS_BASE_V1']);
  });
});
