# CSRF Config

> Customise the framework's CSRF cookie name, header name, token length and cookie options without forking `@luckystack/server`. Source: `packages/core/src/csrfConfig.ts`.

## Overview

LuckyStack has two cookie-mode CSRF branches. With `@luckystack/login`, the login package mints a per-session token and the server compares the configured request header with the session record. Without login, `GET /auth/csrf` issues a JavaScript-readable cookie and the server timing-safely compares that double-submit cookie with the header. Token/sessionStorage mode skips CSRF because the browser does not ambiently attach the bearer token. Use `registerCsrfConfig({ ... })` for external gateway conventions or a stronger token-length policy.

| Setting | Default | Where it is consumed |
|---|---|---|
| `cookieName` | `'csrf-token'` | Login-absent double-submit issue and validation. |
| `headerName` | `'x-csrf-token'` | Middleware reads `req.headers[headerName]`; `httpFetch` attaches it on writes. |
| `tokenLength` | `32` (bytes) | Session-bound and login-absent token minting (`randomBytes(tokenLength).toString('hex')`). |
| `cookieOptions.sameSite` | `'lax'` | Login-absent double-submit cookie. |
| `cookieOptions.secure` | unset | Follows `SECURE=true` unless explicitly overridden. |
| `cookieOptions.httpOnly` | `false` | Compatibility default. May be `true`: the client reads the token from the same-origin JSON response, not from `document.cookie`. |
| `cookieOptions.path` | `'/'` | Double-submit cookie path. |
| `cookieOptions.maxAgeMs` | `86_400_000` (1 day) | Double-submit cookie lifetime. |

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

- The validation branch itself (session-bound comparison with login; timing-safe cookie/header comparison without login).
- Token-mode session behaviour — token-mode sessions skip CSRF entirely (cross-origin requests don't auto-attach `sessionStorage`).
- The framework's HTTP route paths (`GET /auth/csrf` is still the issuing endpoint).
- The `csrfMismatch` hook fan-out — payload shape and timing are unchanged.

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Source: `packages/core/src/csrfConfig.ts`, `packages/core/src/csrf.ts`, `packages/server/src/httpRoutes/csrfMiddleware.ts`, `packages/login/src/session.ts`
- Architecture: `docs/ARCHITECTURE_EXTENSION_POINTS.md`, `packages/server/docs/security-defaults.md`
