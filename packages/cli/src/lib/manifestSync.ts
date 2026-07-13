//? Keeps `.luckystack/scaffold.json` (the scaffold manifest, ADR 0021) in step
//? with reality after `luckystack add/remove/manage`. The manifest's recorded
//? `choices` drive `luckystack update`'s temp re-render — stale choices made
//? the re-render undo deliberate post-scaffold changes (e.g. after
//? `add secret-manager`, an update offered to un-wire prismaWithSecrets.ts).
//? Best-effort by design: no manifest (pre-0.4.1 scaffold) or a parse failure
//? is a silent no-op — never block a feature add on bookkeeping.

import fs from 'node:fs';
import path from 'node:path';
import type { ConsumerProject } from './project';
import { detectProjectState } from './state';

export const MANIFEST_RELATIVE_PATH = path.join('.luckystack', 'scaffold.json');

interface ManifestShape {
  schemaVersion?: number;
  choices?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Re-derive the manifest's `choices` from the project's ACTUAL state (deps +
 * declared env keys) after an add/remove/manage apply. Only the dimensions the
 * CLI can change are synced; scaffold-only choices (orm, dbProvider,
 * aiInstructions, aiBrowserTooling) are left untouched.
 */
export const syncScaffoldManifestChoices = (project: ConsumerProject): boolean => {
  const manifestPath = path.join(project.root, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) return false;

  let manifest: ManifestShape;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestShape;
  } catch {
    return false;
  }
  if (manifest.schemaVersion !== 1) return false;

  //? Re-read package.json from disk — the in-memory `project.pkg` can lag the
  //? dependency edits the apply step just wrote.
  let freshPkg: ConsumerProject['pkg'];
  try {
    freshPkg = JSON.parse(fs.readFileSync(project.pkgPath, 'utf8')) as ConsumerProject['pkg'];
  } catch {
    return false;
  }

  const state = detectProjectState({ ...project, pkg: freshPkg });
  manifest.choices = {
    ...manifest.choices,
    authMode: state.authMode,
    oauthProviders: [...state.oauthProviders],
    emailProvider: state.email,
    monitoringProvider: state.monitoring,
    presence: state.packages.presence === true,
    errorTracking: state.packages['error-tracking'] === true,
    docsUi: state.packages['docs-ui'] === true,
    secretManager: state.packages['secret-manager'] === true,
    router: state.packages.router === true,
    cron: state.packages.cron === true,
  };

  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    return false;
  }
  return true;
};
