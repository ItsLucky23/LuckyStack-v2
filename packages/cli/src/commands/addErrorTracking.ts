//? `luckystack add error-tracking` — installs @luckystack/error-tracking AND copies
//? the `functions/sentry.ts` shim it needs. The scaffolder ships that shim (it
//? re-exports the package as `functions.sentry.*` so handlers can call
//? `functions.sentry.captureException(...)`); the no-error-tracking scaffold deletes
//? it (pruneErrorTracking), so adding the dep alone would leave `functions.sentry.*`
//? unresolved. Picking the actual backend + its SDK + env keys is done via
//? `npx luckystack manage` → Monitoring (planMonitoring), or by setting SENTRY_DSN.

import fs from 'node:fs';
import path from 'node:path';
import {
  addDependency,
  assetPath,
  copyDirIfAbsent,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  toError,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

const ERROR_TRACKING_PKG = '@luckystack/error-tracking';

//? Copy `functions/sentry.ts` into the project if absent (skip-if-exists). Shared
//? with planMonitoring so enabling monitoring via the wizard also ships the shim.
//? Guards a missing asset dir (defensive — the asset ships in the tarball; the
//? guard keeps it from throwing if resolution ever points somewhere unexpected).
export const copySentryShim = (root: string): string[] => {
  const src = assetPath('error-tracking', 'functions');
  if (!fs.existsSync(src)) return [];
  return copyDirIfAbsent(src, path.join(root, 'functions'));
};

//? Delete the shim (inverse). Returns whether a file was removed.
export const removeSentryShim = (root: string): boolean => {
  const file = path.join(root, 'functions', 'sentry.ts');
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
};

export const addErrorTracking = (project: ConsumerProject, options: AddOptions): Result<void> => {
  let written: string[];
  try {
    written = copySentryShim(project.root);
  } catch (error) {
    return err(toError(error));
  }
  if (written.length > 0) console.log('• copied functions/sentry.ts (the functions.sentry.* shim)');
  else console.log('• functions/sentry.ts already present — skipped copy.');

  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, ERROR_TRACKING_PKG, range)) console.log(`• added ${ERROR_TRACKING_PKG}@${range} to package.json`);
    else console.log(`• ${ERROR_TRACKING_PKG} already in package.json`);
  } catch (error) {
    return err(toError(error));
  }

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) console.warn('  npm install failed — run it manually to finish.');
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log('\n✓ error-tracking added. Set SENTRY_DSN (or POSTHOG_KEY) to capture, or run');
  console.log('  `npx luckystack manage` → Monitoring to pick a backend (wires its SDK + env keys).');
  return ok();
};
