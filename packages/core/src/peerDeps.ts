//? Shared optional-peer-dependency guards. The framework's optional adapters
//? (`@luckystack/email`'s Resend/SMTP senders, `@luckystack/error-tracking`'s
//? Sentry/PostHog/Datadog adapters) each hand-rolled the same boot-time guard:
//? `try { localRequire.resolve(pkg) } catch { throw new Error(hint) }`, then a
//? synchronous `require(pkg)` once present. This centralises both halves so
//? the message convention and resolution semantics stay identical everywhere.
//?
//? CommonJS `require` resolution is relative to the MODULE that owns the
//? `require` function. A guard called from `@luckystack/email`'s adapter must
//? resolve `resend` from the consumer's `node_modules`, not core's — so both
//? helpers accept an optional `requireFn` that callers build with
//? `createRequire(import.meta.url)` at their own location. When omitted, the
//? helpers fall back to a `require` based on this module (sufficient inside a
//? flat monorepo / hoisted install).

import { createRequire } from 'node:module';

/** Minimal shape of a Node `require` with the `.resolve` member these guards use. */
export interface PeerRequire {
  (id: string): unknown;
  resolve: (id: string) => string;
}

//? `NodeRequire` (the return of `createRequire`) is structurally a superset of
//? `PeerRequire` — its call signature + `.resolve` satisfy our minimal shape —
//? so it assigns directly with no cast.
const defaultRequire: PeerRequire = createRequire(import.meta.url);

/**
 * Assert that an optional peer package is installed, throwing a consistent,
 * actionable error when it is not. Does NOT load the module — use `loadPeer`
 * for that. Pass `requireFn` (a `createRequire(import.meta.url)` from the
 * calling adapter) so resolution happens from the consumer's perspective.
 *
 * `hint` is appended to the standard "package X is not installed" sentence —
 * e.g. `'Run `npm install resend`, or pick a different EmailSender adapter.'`.
 */
export const ensurePeerDepInstalled = (
  packageName: string,
  hint: string,
  requireFn: PeerRequire = defaultRequire,
): void => {
  try {
    requireFn.resolve(packageName);
  } catch {
    throw new Error(
      `The \`${packageName}\` package is not installed but a feature that needs it was used. ${hint}`,
    );
  }
};

/**
 * Synchronously load an optional peer package, asserting it is installed
 * first (so a missing dependency fails with the actionable `hint` rather than
 * a raw `MODULE_NOT_FOUND`). Returns the module typed as `T`. Pass `requireFn`
 * (built with `createRequire(import.meta.url)` at the call site) so resolution
 * + load happen relative to the calling module.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is a caller-supplied return-shape annotation (typed boundary helper, like a checked cast); single use is intentional
export const loadPeer = <T>(
  packageName: string,
  hint: string,
  requireFn: PeerRequire = defaultRequire,
): T => {
  ensurePeerDepInstalled(packageName, hint, requireFn);
  return requireFn(packageName) as T;
};
