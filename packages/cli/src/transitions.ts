//? The reconfiguration engine (ADR 0014): given the CURRENT config and a DESIRED
//? config, produce a list of `Change`s. Each Change carries BOTH a human-readable
//? consequence preview (`summary` + `effects`) AND an `apply` closure, derived from
//? the same facts so "what we say" and "what we do" can never diverge. The
//? orchestrator (commands/manage.ts) renders the previews, confirms, then applies.
//?
//? Env edits are value-SAFE (see lib/envFile.ts): adding a provider appends empty
//? placeholders; removing one drops only a CLI-written sentinel block (a
//? hand-filled block is kept + the user is told which keys to clear).

import fs from 'node:fs';
import path from 'node:path';
import {
  addDependency,
  dropDependency,
  resolveLuckyStackRange,
  ok,
  err,
  type ConsumerProject,
  type Result,
} from './lib/project';
import { upsertEnvBlock, dropEnvBlock, updateExternalOrigin } from './lib/envFile';
import { findRegistryEntry } from './registry';
import { addPresence } from './commands/addPresence';
import { addDocsUi } from './commands/addDocsUi';
import { addLogin } from './commands/addLogin';
import { addBackendOnly } from './commands/addBackendOnly';
import { removeFeature, pruneLoginDocs, LOGIN_COPIED_PATHS } from './commands/remove';
import type { ProjectState } from './lib/state';
import {
  OAUTH_ORIGINS,
  oauthIdKeys,
  oauthEnvLines,
  emailEnvLines,
  emailKeys,
  monitoringEnvLines,
  monitoringKeys,
  monitoringDeps,
  type AuthMode,
  type OAuthProvider,
  type EmailProvider,
  type MonitoringProvider,
} from './featureOptions';

export const TOGGLE_IDS = ['presence', 'sync', 'docs-ui'] as const;
export type ToggleId = (typeof TOGGLE_IDS)[number];

//? The full reconfigurable surface. The wizard edits this; `configFromState`
//? derives the current one from a detected ProjectState.
export interface DesiredConfig {
  authMode: AuthMode;
  oauthProviders: OAuthProvider[];
  email: EmailProvider;
  monitoring: MonitoringProvider;
  toggles: Record<ToggleId, boolean>;
}

export const configFromState = (state: ProjectState): DesiredConfig => ({
  authMode: state.authMode,
  oauthProviders: [...state.oauthProviders],
  email: state.email,
  monitoring: state.monitoring,
  toggles: {
    presence: state.packages.presence ?? false,
    sync: state.packages.sync ?? false,
    'docs-ui': state.packages['docs-ui'] ?? false,
  },
});

export interface ApplyContext {
  project: ConsumerProject;
  cliVersion: string;
  /** Declared env key names (value-blind) for idempotent env-block upserts. */
  declaredKeys: ReadonlySet<string>;
}

export interface Change {
  /** One-line headline, e.g. "Auth: credentials+oauth → none". */
  summary: string;
  /** Bullet consequences shown under the summary in the preview. */
  effects: string[];
  /** Perform the change. Reuses install-batched handlers (install runs once later). */
  apply: (ctx: ApplyContext) => Result<void>;
}

const lsRange = (ctx: ApplyContext): string => resolveLuckyStackRange(ctx.project.pkg, ctx.cliVersion);

const LOGIN_PKG = '@luckystack/login';
const EMAIL_PKG = '@luckystack/email';
const ERROR_TRACKING_PKG = '@luckystack/error-tracking';

//? Auth UI deleted on a reconfigure→none = exactly the files `addLogin` copies
//? (shared LOGIN_COPIED_PATHS from remove.ts — single source of truth, so add+remove
//? stay symmetric per ADR 0014 D2). The scaffolder ALSO emits functions/session.ts +
//? server/hooks/notifications.ts at creation, but `addLogin` never creates them — so
//? we do NOT auto-delete those (we'd destroy server code the wizard never wrote);
//? they're flagged for manual cleanup in the preview instead.

const wrap =(fn: (ctx: ApplyContext) => void): ((ctx: ApplyContext) => Result<void>) =>
  (ctx) => {
    try {
      fn(ctx);
      return ok();
    } catch (error) {
      //? A thrown value is `unknown` — normalize non-Error throws so the CLI never
      //? prints "✗ undefined" from a missing `.message`.
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  };

// --- OAuth provider changes (granular, so the preview shows each X/Y) ----------

const addProviderChange = (provider: OAuthProvider): Change => ({
  summary: `OAuth provider ${provider}: add`,
  effects: [
    `+ env placeholders DEV_${provider.toUpperCase()}_CLIENT_ID / _SECRET in .env.local (fill the values to enable)`,
    `+ ${OAUTH_ORIGINS[provider]} in EXTERNAL_ORIGINS (.env)`,
  ],
  apply: wrap((ctx) => {
    upsertEnvBlock(ctx.project.root, `oauth:${provider}`, oauthEnvLines(provider), ctx.declaredKeys, [...oauthIdKeys(provider)]);
    updateExternalOrigin(ctx.project.root, OAUTH_ORIGINS[provider], 'add');
  }),
});

const removeProviderChange = (provider: OAuthProvider): Change => ({
  summary: `OAuth provider ${provider}: remove`,
  effects: [
    `- ${OAUTH_ORIGINS[provider]} from EXTERNAL_ORIGINS (.env)`,
    `- the ${provider} placeholder block from .env.local (if CLI-written; a hand-filled block is kept — clear DEV_${provider.toUpperCase()}_* yourself)`,
  ],
  apply: wrap((ctx) => {
    dropEnvBlock(ctx.project.root, `oauth:${provider}`);
    updateExternalOrigin(ctx.project.root, OAUTH_ORIGINS[provider], 'remove');
  }),
});

// --- Auth dimension -----------------------------------------------------------

const addLoginChange = (): Change => ({
  summary: 'Auth: enable credentials login',
  effects: [
    `+ ${LOGIN_PKG}`,
    '+ src/login, src/register, src/reset-password, src/settings, src/_components/LoginForm.tsx',
  ],
  apply: (ctx) => addLogin(ctx.project, { install: false, cliVersion: ctx.cliVersion }),
});

const removeLoginChange = (): Change => ({
  summary: 'Auth: → none (remove login)',
  effects: [
    `- ${LOGIN_PKG}`,
    '- delete src/login, src/register, src/reset-password, src/settings, src/_components/LoginForm.tsx',
    '- strip login sections from README.md (best-effort)',
    '⚠ scaffolded auth server code (functions/session.ts, server/hooks/notifications.ts) is KEPT — delete it by hand if unused',
    '⚠ if a page redirects to /login (e.g. src/page.tsx middleware), update it — the auth routes are gone',
  ],
  apply: wrap((ctx) => {
    for (const rel of LOGIN_COPIED_PATHS) {
      const target = path.join(ctx.project.root, rel);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    dropDependency(ctx.project, LOGIN_PKG);
    //? Mirror the single-feature `remove login`: strip login-as-installed prose from
    //? README so the manage path leaves the same clean state.
    pruneLoginDocs(ctx.project.root);
  }),
});

//? Auth + OAuth providers as a set of granular changes.
const planAuth = (current: DesiredConfig, desired: DesiredConfig): Change[] => {
  const changes: Change[] = [];
  const loginNow = current.authMode !== 'none';
  const loginWant = desired.authMode !== 'none';
  if (!loginNow && loginWant) changes.push(addLoginChange());

  const currentProviders = current.authMode === 'credentials+oauth' ? current.oauthProviders : [];
  const desiredProviders = desired.authMode === 'credentials+oauth' ? desired.oauthProviders : [];
  for (const p of desiredProviders.filter((x) => !currentProviders.includes(x))) changes.push(addProviderChange(p));
  for (const p of currentProviders.filter((x) => !desiredProviders.includes(x))) changes.push(removeProviderChange(p));

  if (loginNow && !loginWant) changes.push(removeLoginChange());
  return changes;
};

// --- Email dimension ----------------------------------------------------------

const planEmail = (current: DesiredConfig, desired: DesiredConfig): Change[] => {
  if (current.email === desired.email) return [];
  const to = desired.email;
  const from = current.email;

  //? effects start empty — the summary already carries the "Email: x → y" headline.
  const effects: string[] = [];
  if (to === 'none') {
    effects.push(`- ${EMAIL_PKG}`);
    //? Only resend/smtp ever wrote a CLI block; console has no env keys.
    if (from === 'resend' || from === 'smtp') effects.push(`- the ${from} placeholder block from .env.local (if CLI-written)`);
  } else {
    //? Switching adapters drops the previous adapter's CLI block (apply does this) —
    //? show it so the preview matches.
    if ((from === 'resend' || from === 'smtp') && from !== to) {
      effects.push(`- the ${from} placeholder block from .env.local (if CLI-written)`);
    }
    effects.push(`+ ${EMAIL_PKG}${from === 'none' ? '' : ' (already present)'}`);
    if (to === 'console') effects.push('console (dev) sender — emails log to the terminal; set Resend/SMTP for real delivery');
    else effects.push(`+ ${to} placeholder keys in .env.local (fill the values)`);
  }

  return [{
    summary: `Email: ${from} → ${to}`,
    effects,
    apply: wrap((ctx) => {
      //? Drop only the PREVIOUS adapter's CLI block (only resend/smtp ever wrote
      //? one) — scoped to `from` so apply matches the preview exactly.
      if (from === 'resend' || from === 'smtp') dropEnvBlock(ctx.project.root, `email:${from}`);
      if (to === 'none') {
        dropDependency(ctx.project, EMAIL_PKG);
        return;
      }
      addDependency(ctx.project, EMAIL_PKG, lsRange(ctx));
      if (to === 'resend' || to === 'smtp') {
        upsertEnvBlock(ctx.project.root, `email:${to}`, emailEnvLines(to), ctx.declaredKeys, [...emailKeys[to]]);
      }
    }),
  }];
};

// --- Monitoring dimension -----------------------------------------------------

const planMonitoring = (current: DesiredConfig, desired: DesiredConfig): Change[] => {
  if (current.monitoring === desired.monitoring) return [];
  const to = desired.monitoring;
  const from = current.monitoring;

  const effects: string[] = [];
  if (to === 'none') {
    effects.push(`- ${ERROR_TRACKING_PKG}`, ...Object.keys(monitoringDeps[from]).map((d) => `- ${d}`), `- the ${from} placeholder block from .env.local (if CLI-written)`);
  } else {
    //? Backend→backend switch ALSO removes the previous backend (apply does this);
    //? show it so the preview matches what happens.
    if (from !== 'none') {
      effects.push(...Object.keys(monitoringDeps[from]).map((d) => `- ${d}`), `- the ${from} placeholder block from .env.local (if CLI-written)`);
    }
    effects.push(`+ ${ERROR_TRACKING_PKG}${from === 'none' ? '' : ' (already present)'}`, ...Object.keys(monitoringDeps[to]).map((d) => `+ ${d}`), `+ ${to} placeholder keys in .env.local (fill the values)`);
    if (to === 'datadog') effects.push('⚠ Datadog also needs the dd-trace block uncommented atop server/server.ts');
  }

  return [{
    summary: `Monitoring: ${from} → ${to}`,
    effects,
    apply: wrap((ctx) => {
      if (to === 'none') {
        dropDependency(ctx.project, ERROR_TRACKING_PKG);
        for (const dep of Object.keys(monitoringDeps[from])) dropDependency(ctx.project, dep);
        dropEnvBlock(ctx.project.root, `monitoring:${from}`);
        return;
      }
      addDependency(ctx.project, ERROR_TRACKING_PKG, lsRange(ctx));
      for (const [dep, range] of Object.entries(monitoringDeps[to])) addDependency(ctx.project, dep, range);
      //? Switching backends: drop the previous one's CLI block + deps.
      if (from !== 'none' && from !== to) {
        dropEnvBlock(ctx.project.root, `monitoring:${from}`);
        for (const dep of Object.keys(monitoringDeps[from])) dropDependency(ctx.project, dep);
      }
      upsertEnvBlock(ctx.project.root, `monitoring:${to}`, monitoringEnvLines(to), ctx.declaredKeys, [...monitoringKeys[to]]);
    }),
  }];
};

// --- Toggle features (presence / sync / docs-ui) ------------------------------

const TOGGLE_EFFECTS: Record<ToggleId, { on: string[]; off: string[] }> = {
  presence: {
    on: ['+ @luckystack/presence + <LocationProvider/> / <SocketStatusIndicator/> client mounts + config flags on'],
    off: ['- @luckystack/presence + reverse the client mounts + config flags off'],
  },
  sync: {
    on: ['+ @luckystack/sync (real-time sync events; client bridge auto-attaches)'],
    off: ['- @luckystack/sync'],
  },
  'docs-ui': {
    on: ['+ @luckystack/docs-ui + src/docs/page.tsx (the editable API explorer)'],
    off: ['- @luckystack/docs-ui + delete src/docs/page.tsx'],
  },
};

const planToggles = (current: DesiredConfig, desired: DesiredConfig): Change[] => {
  const changes: Change[] = [];
  for (const id of TOGGLE_IDS) {
    const now = current.toggles[id];
    const want = desired.toggles[id];
    if (now === want) continue;
    const entry = findRegistryEntry(id);
    if (!entry) continue;
    changes.push({
      summary: `${id}: ${now ? 'on → off' : 'off → on'}`,
      effects: want ? TOGGLE_EFFECTS[id].on : TOGGLE_EFFECTS[id].off,
      apply: (ctx) => {
        const options = { install: false, cliVersion: ctx.cliVersion };
        if (want) {
          if (id === 'presence') return addPresence(ctx.project, options);
          if (id === 'docs-ui') return addDocsUi(ctx.project, options, entry.note ?? '');
          return addBackendOnly(ctx.project, entry.pkg, options, entry.note ?? '');
        }
        return removeFeature(ctx.project, entry);
      },
    });
  }
  return changes;
};

//? Full diff current → desired as an ordered list of granular changes.
export const planChanges = (current: DesiredConfig, desired: DesiredConfig): Change[] => [
  ...planAuth(current, desired),
  ...planEmail(current, desired),
  ...planMonitoring(current, desired),
  ...planToggles(current, desired),
];
