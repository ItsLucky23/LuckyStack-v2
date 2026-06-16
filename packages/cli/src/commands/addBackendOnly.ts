//? Generic `luckystack add <feature>` handler for backend-only optional packages
//? that need NO consumer-`src/` changes — they self-wire at boot via their
//? `@luckystack/<pkg>/register` subpath (email, error-tracking, docs-ui) or via
//? the always-present client bridge (sync). For these, `add` is just `npm i` +
//? the dependency line + a restart reminder. (`add` exists for them mainly so the
//? whole optional surface is reachable through one consistent command.)

import { addDependency, err, ok, resolveLuckyStackRange, runNpmInstall, type ConsumerProject, type Result } from '../lib/project';
import type { AddOptions } from './addPresence';

export const addBackendOnly = (
  project: ConsumerProject,
  packageName: string,
  options: AddOptions,
  note: string,
): Result<void> => {
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, packageName, range)) {
      console.log(`• added ${packageName}@${range} to package.json`);
    } else {
      console.log(`• ${packageName} already in package.json`);
    }
  } catch (error) {
    return err(error as Error);
  }

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log(`\n✓ ${packageName} added. Restart the server. ${note}`);
  return ok();
};
