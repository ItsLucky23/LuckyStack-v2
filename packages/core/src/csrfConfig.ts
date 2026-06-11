//? CSRF configuration registry. The framework's CSRF middleware
//? (`packages/server/src/httpRoutes/csrfMiddleware.ts`) and the
//? client-side fetch wrapper (`packages/core/src/csrf.ts`) both consult
//? `getCsrfConfig()` so consumers can change the header name, cookie
//? name, token length, or cookie options without forking.
//?
//? The default values match the framework's pre-registry hardcodes
//? (header `x-csrf-token`, 32-byte hex token minted at session create) so
//? consumers who never call `registerCsrfConfig` get the historical
//? behaviour unchanged.

import { createRegistry } from './createRegistry';

export interface CsrfCookieOptions {
  sameSite?: 'strict' | 'lax' | 'none';
  secure?: boolean;
  /**
   * MUST be false for CSRF cookies — the client needs to read the value
   * with JS to attach it as a request header. The framework reads the
   * value from the session record (Redis-side) rather than the cookie,
   * so this flag is documentation/intent only.
   */
  httpOnly?: boolean;
  path?: string;
  maxAgeMs?: number;
}

export interface CsrfConfig {
  /** Cookie name used to deliver the CSRF token to the browser. */
  cookieName: string;
  /** Request-header name the client attaches on state-changing requests. */
  headerName: string;
  /** Length in bytes of the random token minted by the session layer. */
  tokenLength: number;
  cookieOptions: CsrfCookieOptions;
}

export const DEFAULT_CSRF_CONFIG: CsrfConfig = {
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  tokenLength: 32,
  cookieOptions: {
    sameSite: 'lax',
    secure: true,
    httpOnly: false,
    path: '/',
    maxAgeMs: 24 * 60 * 60 * 1000,
  },
};

const registry = createRegistry<CsrfConfig, Partial<CsrfConfig>>(DEFAULT_CSRF_CONFIG, {
  //? Merge shallowly with the CURRENT config; `cookieOptions` is deep-merged
  //? so a partial override of (say) `sameSite` does not clobber `path` /
  //? `maxAgeMs`. Last-write-wins, and successive calls accumulate.
  transform: (input, current) => ({
    ...current,
    ...input,
    cookieOptions: { ...current.cookieOptions, ...input.cookieOptions },
  }),
});

/**
 * Override one or more CSRF settings. Merges shallowly with the current
 * config; `cookieOptions` is deep-merged so a partial override of (say)
 * `sameSite` does not clobber `path` / `maxAgeMs`. Last-write-wins.
 */
export const registerCsrfConfig = (input: Partial<CsrfConfig>): void => {
  registry.register(input);
};

/** Read the active config at call time (never at module load). */
export const getCsrfConfig = (): CsrfConfig => registry.get();

/** Test-only — restore defaults between scenarios. */
export const resetCsrfConfigForTests = (): void => {
  registry.reset();
};
