//? Detects a project's CURRENT reconfigurable state so `manage` can pre-fill each
//? wizard step with what's actually there (ADR 0014). State that isn't stored
//? explicitly (authMode, active OAuth providers, email/monitoring backend) is
//? inferred from installed packages + declared env KEY NAMES (never values, Rule
//? 16 / ADR 0014 D1).

import fs from 'node:fs';
import path from 'node:path';
import { hasDependency, type ConsumerProject } from './project';
import { readDeclaredEnvKeys, anyKeyDeclared } from './envKeys';
import { REGISTRY } from '../registry';
import {
  OAUTH_PROVIDERS,
  MONITORING_PROVIDERS,
  oauthIdKeys,
  emailKeys,
  monitoringKeys,
  type AuthMode,
  type OAuthProvider,
  type EmailProvider,
  type MonitoringProvider,
} from '../featureOptions';

//? The project's data layer. EVERY orm-sensitive CLI path (manage wizard,
//? add login, previews) reads this instead of assuming Prisma — the scaffold
//? has shipped orm variants since 0.5.0 (ADR 0020).
export type DetectedOrm = 'prisma' | 'drizzle' | 'mikro-orm' | 'none';
const DETECTED_ORMS: readonly DetectedOrm[] = ['prisma', 'drizzle', 'mikro-orm', 'none'];

export interface ProjectState {
  authMode: AuthMode;
  oauthProviders: OAuthProvider[];
  email: EmailProvider;
  monitoring: MonitoringProvider;
  /** Data layer: scaffold-manifest value when present, else dep-inferred. */
  orm: DetectedOrm;
  /** Registry id -> installed (from package.json). */
  packages: Record<string, boolean>;
}

//? Pure inputs so the derivation is unit-testable without a real project.
export interface StateInputs {
  /** Is this npm package a dependency? (registry pkg names) */
  hasPackage: (pkg: string) => boolean;
  /** Declared env key NAMES (value-blind). */
  declaredKeys: ReadonlySet<string>;
  /** `.luckystack/scaffold.json` `choices.orm`, when a manifest exists. */
  scaffoldOrm?: unknown;
}

//? Manifest value wins (it records the deliberate choice); dependency
//? inference covers pre-manifest projects and hand-rolled setups.
export const deriveOrm = (inputs: Pick<StateInputs, 'hasPackage' | 'scaffoldOrm'>): DetectedOrm => {
  const recorded = DETECTED_ORMS.find((orm) => orm === inputs.scaffoldOrm);
  if (recorded) return recorded;
  if (inputs.hasPackage('@prisma/client')) return 'prisma';
  if (inputs.hasPackage('drizzle-orm')) return 'drizzle';
  if (inputs.hasPackage('@mikro-orm/core')) return 'mikro-orm';
  return 'none';
};

const LOGIN_PKG = '@luckystack/login';
const EMAIL_PKG = '@luckystack/email';
const ERROR_TRACKING_PKG = '@luckystack/error-tracking';

//? Pure state derivation from the gathered inputs.
export const deriveState = (inputs: StateInputs): ProjectState => {
  const { hasPackage, declaredKeys } = inputs;

  //? Auth is "on" iff @luckystack/login is installed — the PACKAGE is the source of
  //? truth (a guarded `remove login` keeps the src/ UI but drops the dep, so a
  //? UI-based check would contradict `packages.login`). OAuth providers are only
  //? meaningful with login on; a stale OAuth key after an uninstall must not
  //? resurrect providers. With any OAuth id key declared it's credentials+oauth.
  const loginOn = hasPackage(LOGIN_PKG);
  const oauthProviders = loginOn
    ? OAUTH_PROVIDERS.filter((provider) => anyKeyDeclared(declaredKeys, oauthIdKeys(provider)))
    : [];
  let authMode: AuthMode;
  if (!loginOn) authMode = 'none';
  else if (oauthProviders.length > 0) authMode = 'credentials+oauth';
  else authMode = 'credentials';

  //? Email: a backend is only "active" when @luckystack/email is INSTALLED. A
  //? stale RESEND_API_KEY after a dep removal must not report 'resend'. With the
  //? package: adapter key → resend/smtp, else the console (dev) sender.
  let email: EmailProvider;
  if (!hasPackage(EMAIL_PKG)) email = 'none';
  else if (anyKeyDeclared(declaredKeys, emailKeys.resend)) email = 'resend';
  else if (anyKeyDeclared(declaredKeys, emailKeys.smtp)) email = 'smtp';
  else email = 'console';

  //? Monitoring: a backend is only "active" when @luckystack/error-tracking is
  //? installed (else a stale SENTRY_DSN would falsely report 'sentry'). The
  //? candidate list is derived from MONITORING_PROVIDERS so a new backend can't
  //? silently drift out of detection.
  let monitoring: MonitoringProvider = 'none';
  if (hasPackage(ERROR_TRACKING_PKG)) {
    for (const candidate of MONITORING_PROVIDERS.filter((p) => p !== 'none')) {
      if (anyKeyDeclared(declaredKeys, monitoringKeys[candidate])) {
        monitoring = candidate;
        break;
      }
    }
  }

  const packages: Record<string, boolean> = {};
  for (const entry of REGISTRY) packages[entry.id] = hasPackage(entry.pkg);

  return {
    authMode,
    oauthProviders,
    email,
    monitoring,
    orm: deriveOrm(inputs),
    packages,
  };
};

//? Read `.luckystack/scaffold.json` `choices.orm` (best-effort; absent on
//? pre-0.4.1 scaffolds and hand-rolled projects — dep inference covers those).
export const readScaffoldOrm = (root: string): unknown => {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, '.luckystack', 'scaffold.json'), 'utf8'),
    ) as { choices?: { orm?: unknown } };
    return manifest.choices?.orm;
  } catch {
    return undefined;
  }
};

//? Gather the real inputs from a located project, then derive.
export const detectProjectState = (project: ConsumerProject): ProjectState =>
  deriveState({
    hasPackage: (pkg) => hasDependency(project.pkg, pkg),
    declaredKeys: readDeclaredEnvKeys(project.root),
    scaffoldOrm: readScaffoldOrm(project.root),
  });
