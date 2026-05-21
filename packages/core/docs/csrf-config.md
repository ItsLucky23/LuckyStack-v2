# CSRF Config

> Customise the framework's CSRF cookie name, header name, token length and cookie options without forking `@luckystack/server`. Source: `packages/core/src/csrfConfig.ts`. Bijgewerkt: 2026-05-21.

## Overview

LuckyStack's CSRF defense is double-submit: on first session write, the login package mints a per-session token; the server reads it from the session record on every state-changing request and compares it against the value the browser sends in a request header. Consumers who need to integrate with an external framework expectation (legacy `x-xsrf-token`, a custom auth gateway that rewrites cookies, FIPS-grade token length) override the defaults via `registerCsrfConfig({ ... })`.

| Setting | Default | Where it is consumed |
|---|---|---|
| `cookieName` | `'csrf-token'` | Reserved for future cookie-issued tokens (current double-submit uses session record). |
| `headerName` | `'x-csrf-token'` | Server: `csrfMiddleware.ts` reads `req.headers[headerName]`. Client: `httpFetch` attaches `headerName` on state-changing requests. |
| `tokenLength` | `32` (bytes) | Session mint in `packages/login/src/session.ts` (`randomBytes(tokenLength).toString('hex')`). |
| `cookieOptions.sameSite` | `'lax'` | Cookie attributes if/when the framework migrates to cookie-issued tokens. |
| `cookieOptions.secure` | `true` | Same. |
| `cookieOptions.httpOnly` | `false` | MUST be false for CSRF cookies — clients need to read the value. |
| `cookieOptions.path` | `'/'` | Same. |
| `cookieOptions.maxAgeMs` | `86_400_000` (1 day) | Same. |

## API Reference

### `registerCsrfConfig(input: Partial<CsrfConfig>): void`

**Signature:**
```typescript
export interface CsrfConfig {
  cookieName: string;
  headerName: string;
  tokenLength: number;
  cookieOptions: CsrfCookieOptions;
}
export const registerCsrfConfig = (input: Partial<CsrfConfig>): void
```

**Behavior:** Shallow-merges `input` over the current config. `cookieOptions` is deep-merged so a partial override of `sameSite` does not clobber `path` / `maxAgeMs`. Last-write-wins.

**Example — rename the header for an external gateway:**
```typescript
import { registerCsrfConfig } from '@luckystack/core';

registerCsrfConfig({
  headerName: 'x-xsrf-token',
});
```

**Example — FIPS-grade token length + strict same-site:**
```typescript
import { registerCsrfConfig } from '@luckystack/core';

registerCsrfConfig({
  tokenLength: 64,
  cookieOptions: { sameSite: 'strict' },
});
```

### `getCsrfConfig(): CsrfConfig`

Read the active config at call time. Framework code uses this — never read at module load.

### `DEFAULT_CSRF_CONFIG: CsrfConfig`

Exported so consumers can spread + override structurally:

```typescript
import { DEFAULT_CSRF_CONFIG, registerCsrfConfig } from '@luckystack/core';

registerCsrfConfig({
  ...DEFAULT_CSRF_CONFIG,
  headerName: 'x-app-csrf',
});
```

### `resetCsrfConfigForTests(): void`

Test-only helper. Restore defaults between scenarios. Not part of the runtime contract.

## What this does NOT change

- The double-submit comparison logic itself (`csrfSession.csrfToken === provided`).
- Token-mode session behaviour — token-mode sessions skip CSRF entirely (cross-origin requests don't auto-attach `sessionStorage`).
- The framework's HTTP route paths (`GET /auth/csrf` is still the issuing endpoint).
- The `csrfMismatch` hook fan-out — payload shape and timing are unchanged.

## Related

- Function INDEX: `packages/core/AI_INDEX.md`
- Source: `packages/core/src/csrfConfig.ts`, `packages/core/src/csrf.ts`, `packages/server/src/httpRoutes/csrfMiddleware.ts`, `packages/login/src/session.ts`
- Architecture: `docs/ARCHITECTURE_EXTENSION_POINTS.md`, `packages/server/docs/security-defaults.md`
