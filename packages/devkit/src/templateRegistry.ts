//? Consumer-facing override registry for the bundled scaffold templates.
//? `templateInjector.ts` reads from this map BEFORE falling back to the
//? disk template under `packages/devkit/src/templates/*.template.ts`, so
//? a consumer can ship their own house-style template via a one-liner in
//? their `luckystack/devkit/templates.ts` overlay:
//?
//?   import { registerTemplate } from '@luckystack/devkit';
//?   import myPagePlain from './my-page-plain.template?raw';
//?   registerTemplate('page_plain', myPagePlain);
//?
//? The supplied string is written to disk verbatim (after the standard
//? `{{REL_PATH}}` / `{{PAGE_PATH}}` / `{{SYNC_NAME}}` placeholder
//? substitutions). Strings rather than file paths because Vite's `?raw`
//? import handles file → string seamlessly and a string registry avoids
//? a second fs-resolution code path inside devkit.
//?
//? Scope (v1): override the 6 BUILT-IN template kinds. Adding brand-new
//? template kinds (e.g. a custom `page_admin` variant) requires also
//? telling the injector when to pick it — see `getTemplate` in
//? `templateInjector.ts`. That's a future extension; this registry only
//? handles overrides of the existing kinds today.

/**
 * The six template kinds the framework currently injects. Order mirrors
 * the discovery flow in `templateInjector.ts:getTemplate`:
 * - `api` — fired when a new versioned file appears in `_api/`
 * - `sync_server` — `_sync/<name>_server_v<N>.ts` (no paired client yet, or independent)
 * - `sync_client_paired` — `_sync/<name>_client_v<N>.ts` when the paired `_server_v<N>.ts` exists
 * - `sync_client_standalone` — `_sync/<name>_client_v<N>.ts` without a paired server
 * - `page_plain` — `page.tsx` whose folder path does NOT match the dashboard heuristic
 * - `page_dashboard` — `page.tsx` whose folder path matches `admin|dashboard|settings|billing|account|profile`
 */
export type TemplateKind =
  | 'api'
  | 'sync_server'
  | 'sync_client_paired'
  | 'sync_client_standalone'
  | 'page_plain'
  | 'page_dashboard';

const overrides = new Map<TemplateKind, string>();

/**
 * Override the bundled template for a given kind. Subsequent injections
 * (hot-reload-driven new files + the `scaffold:page` CLI) emit the
 * supplied content with the same `{{REL_PATH}}` / `{{PAGE_PATH}}` /
 * `{{SYNC_NAME}}` placeholder substitution rules as the built-in
 * templates.
 *
 * Pass an empty string to effectively delete a content; pass `null` via
 * `clearTemplateOverrides()` to drop every registration (test helper).
 */
export const registerTemplate = (kind: TemplateKind, content: string): void => {
  overrides.set(kind, content);
};

/**
 * Read the consumer override for a given template kind. Returns `null`
 * when no override is registered — callers should fall back to the
 * bundled disk template.
 */
export const getRegisteredTemplate = (kind: TemplateKind): string | null => {
  return overrides.get(kind) ?? null;
};

/**
 * Drop every registered override. Test-only — leaving overrides
 * registered between test files would leak state across the suite.
 */
export const clearTemplateOverrides = (): void => {
  overrides.clear();
};

/** Diagnostic: which kinds currently have an override registered. */
export const listRegisteredTemplateKinds = (): readonly TemplateKind[] => {
  return [...overrides.keys()];
};
