//? Session-field redaction seam (M7). The default session record persisted to
//? the store AND broadcast to the browser is the full user row minus only
//? `password` (see `sanitizeUserForSession` in login.ts). Any other sensitive
//? column (2FA secrets, billing ids, internal flags) would otherwise leak to
//? the client. `preSessionCreate` is veto-only (it cannot mutate the payload),
//? so there was no supported way to redact fields. This registry provides one:
//? register a sanitizer that returns the session shape to persist/broadcast.
//?
//? The sanitizer runs on EVERY session write (saveSession), so it covers the
//? credentials, register, and OAuth paths uniformly without each having to
//? remember to redact. It must be PURE and SYNCHRONOUS (hot path) and must
//? return a session object — returning the input unchanged is the no-op default.

import type { BaseSessionLayout } from './sessionLayout';

export type SessionSanitizer = (session: BaseSessionLayout) => BaseSessionLayout;

let registeredSanitizer: SessionSanitizer | null = null;

/**
 * Register a redactor applied to the session record before it is persisted to
 * the store and broadcast to connected clients. Call once at boot. Last write
 * wins. Pass a function that returns a shallow copy with sensitive fields
 * stripped, e.g. `({ totpSecret, stripeCustomerId, ...safe }) => safe`.
 */
export const registerSessionSanitizer = (sanitizer: SessionSanitizer): void => {
  registeredSanitizer = sanitizer;
};

/** Read the active sanitizer (or `null` when none is registered). */
export const getSessionSanitizer = (): SessionSanitizer | null => registeredSanitizer;

/**
 * Apply the registered sanitizer (no-op identity when none registered). Used by
 * `saveSession`. Defensive: a throwing sanitizer must not break login, so the
 * caller falls back to the un-sanitized record on error (logged by the caller).
 */
export const applySessionSanitizer = (session: BaseSessionLayout): BaseSessionLayout => {
  if (!registeredSanitizer) return session;
  return registeredSanitizer(session);
};

/** Test-only: clear the registered sanitizer between scenarios. */
export const resetSessionSanitizerForTests = (): void => {
  registeredSanitizer = null;
};
