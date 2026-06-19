//? Detects a project's CURRENT reconfigurable state so `manage` can pre-fill each
//? wizard step with what's actually there (ADR 0014). State that isn't stored
//? explicitly (authMode, active OAuth providers, email/monitoring backend) is
//? inferred from installed packages + declared env KEY NAMES (never values, Rule
//? 16 / ADR 0014 D1) + the presence of the login UI under `src/`.

import fs from 'node:fs';
import path from 'node:path';
import { hasDependency, type ConsumerProject } from './project';
import { readDeclaredEnvKeys, anyKeyDeclared } from './envKeys';
import { REGISTRY } from '../registry';
import {
  OAUTH_PROVIDERS,
  oauthIdKeys,
  emailKeys,
  monitoringKeys,
  type AuthMode,
  type OAuthProvider,
  type EmailProvider,
  type MonitoringProvider,
} from '../featureOptions';

export interface ProjectState {
  authMode: AuthMode;
  oauthProviders: OAuthProvider[];
  email: EmailProvider;
  monitoring: MonitoringProvider;
  /** Registry id -> installed (from package.json). */
  packages: Record<string, boolean>;
}

//? Pure inputs so the derivation is unit-testable without a real project.
export interface StateInputs {
  /** Is this npm package a dependency? (registry pkg names) */
  hasPackage: (pkg: string) => boolean;
  /** Does the auth UI exist under src/ (src/login/page.tsx)? */
  hasLoginUi: boolean;
  /** Declared env key NAMES (value-blind). */
  declaredKeys: ReadonlySet<string>;
}

const LOGIN_PKG = '@luckystack/login';
const EMAIL_PKG = '@luckystack/email';

//? Pure state derivation from the gathered inputs.
export const deriveState = (inputs: StateInputs): ProjectState => {
  const { hasPackage, hasLoginUi, declaredKeys } = inputs;

  const oauthProviders = OAUTH_PROVIDERS.filter((provider) =>
    anyKeyDeclared(declaredKeys, oauthIdKeys(provider)),
  );

  //? Login presence = dep OR the copied UI (either signals "auth is on"). With
  //? any OAuth id key declared it's credentials+oauth, else plain credentials.
  const loginOn = hasPackage(LOGIN_PKG) || hasLoginUi;
  let authMode: AuthMode;
  if (!loginOn) authMode = 'none';
  else if (oauthProviders.length > 0) authMode = 'credentials+oauth';
  else authMode = 'credentials';

  //? Email: an adapter key wins; otherwise the package being installed means the
  //? console (dev) sender is active; otherwise off.
  let email: EmailProvider;
  if (anyKeyDeclared(declaredKeys, emailKeys.resend)) email = 'resend';
  else if (anyKeyDeclared(declaredKeys, emailKeys.smtp)) email = 'smtp';
  else if (hasPackage(EMAIL_PKG)) email = 'console';
  else email = 'none';

  //? Monitoring: whichever backend's key is declared (first match wins), else off.
  let monitoring: MonitoringProvider = 'none';
  for (const candidate of ['sentry', 'datadog', 'posthog'] as const) {
    if (anyKeyDeclared(declaredKeys, monitoringKeys[candidate])) {
      monitoring = candidate;
      break;
    }
  }

  const packages: Record<string, boolean> = {};
  for (const entry of REGISTRY) packages[entry.id] = hasPackage(entry.pkg);

  return { authMode, oauthProviders, email, monitoring, packages };
};

//? Gather the real inputs from a located project, then derive.
export const detectProjectState = (project: ConsumerProject): ProjectState =>
  deriveState({
    hasPackage: (pkg) => hasDependency(project.pkg, pkg),
    hasLoginUi: fs.existsSync(path.join(project.root, 'src', 'login', 'page.tsx')),
    declaredKeys: readDeclaredEnvKeys(project.root),
  });
