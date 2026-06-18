//? Single source of truth for the optional `@luckystack/*` packages the CLI can
//? add, remove, and list. Both the `add <feature>` dispatch (index.ts derives its
//? FEATURES map from here) and the `list` / `manage` commands read this array, so
//? a new manageable package is declared in exactly ONE place. Mirror it against
//? `OPTIONAL_PACKAGES` in `@luckystack/server` (asset-parity test enforces it).

//? How a package is wired into the consumer project, which selects the add/remove
//? handler:
//?   - 'login'    : copies consumer-owned auth UI into src/ (guarded removal).
//?   - 'presence' : injects/reverses client JSX mounts in main.tsx + TemplateProvider.
//?   - 'backend'  : dependency-only; self-wires at boot (or via the sync client bridge).
export type FeatureKind = 'login' | 'presence' | 'backend';

//? Removal safety:
//?   - 'safe'    : removal fully reverses the add (drop dep + reverse JSX). No
//?                 user-owned files are touched.
//?   - 'guarded' : add copied consumer-owned files (login pages) the user may have
//?                 edited; removal drops the dep but KEEPS those files + warns.
export type Removable = 'safe' | 'guarded';

export interface RegistryEntry {
  /** The `add <feature>` token + the package's short id (without the `@luckystack/` scope). */
  id: string;
  /** Full npm package name. */
  pkg: string;
  /** Which add/remove handler wires this package into the consumer project. */
  kind: FeatureKind;
  /** One-line, plain-language description shown by `list` / `manage` + the help banner. */
  description: string;
  /** Removal safety class (see `Removable`). */
  removable: Removable;
  /** Post-add restart/env reminder (backend features surface this after install). */
  note?: string;
}

//? The CLI-manageable optional packages. Order = how they're listed/prompted.
export const REGISTRY: readonly RegistryEntry[] = [
  {
    id: 'login',
    pkg: '@luckystack/login',
    kind: 'login',
    description: 'Auth backend + editable /login,/register,/reset-password,/settings pages + LoginForm',
    removable: 'guarded',
    note:
      'Restart the server. The auth backend self-wires from env (set DEV_<PROVIDER>_CLIENT_ID/SECRET to enable an OAuth provider).',
  },
  {
    id: 'presence',
    pkg: '@luckystack/presence',
    kind: 'presence',
    description: 'Presence backend + client mounts (LocationProvider, SocketStatusIndicator)',
    removable: 'safe',
    note: 'Restart the dev server. Presence is gated by `socketActivityBroadcaster` / `socketStatusIndicator` in config.ts.',
  },
  {
    id: 'email',
    pkg: '@luckystack/email',
    kind: 'backend',
    description: 'Transactional email (Resend / SMTP / console)',
    removable: 'safe',
    note: 'Set RESEND_API_KEY (or SMTP_HOST) to send real mail; otherwise mail logs to the console.',
  },
  {
    id: 'sync',
    pkg: '@luckystack/sync',
    kind: 'backend',
    description: 'Real-time sync events (client bridge attaches automatically)',
    removable: 'safe',
    note: 'Real-time sync events now work; the client receive bridge attaches automatically.',
  },
  {
    id: 'error-tracking',
    pkg: '@luckystack/error-tracking',
    kind: 'backend',
    description: 'Sentry / PostHog error tracking',
    removable: 'safe',
    note: 'Set SENTRY_DSN (or POSTHOG_KEY) to start capturing.',
  },
  {
    id: 'docs-ui',
    pkg: '@luckystack/docs-ui',
    kind: 'backend',
    description: 'Dev API docs page at /_docs',
    removable: 'safe',
    note: 'The API docs page mounts at /_docs in development.',
  },
] as const;

//? Lookup an entry by its `add <feature>` id. Returns undefined for an unknown id.
export const findRegistryEntry = (id: string): RegistryEntry | undefined =>
  REGISTRY.find((entry) => entry.id === id);
