//? `luckystack add router` / `remove` — mirror of the scaffolder's `wireRouter`:
//? @luckystack/router is a multi-instance load-balancer that runs as a SEPARATE
//? process (`npm run router`) reading the project's deploy.config.ts. Add wires the
//? dependency + the `router` npm script; remove drops both. A single-instance app
//? never runs it — it's here so scaling out later is `npm run router`, no rewiring.

import {
  addDependency,
  dropDependency,
  setScript,
  dropScript,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  toError,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

const PKG = '@luckystack/router';

export const addRouter = (project: ConsumerProject, options: AddOptions): Result<void> => {
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, PKG, range)) console.log(`• added ${PKG}@${range} to package.json`);
    else console.log(`• ${PKG} already in package.json`);
    if (setScript(project, 'router', 'luckystack-router')) console.log("• added the `router` npm script (npm run router)");
    else console.log("• 'router' npm script already present");
  } catch (error) {
    return err(toError(error));
  }
  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) console.warn('  npm install failed — run it manually to finish.');
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }
  console.log('\n✓ router added. Start it with `npm run router` (topology lives in deploy.config.ts;');
  console.log('  env: ROUTER_PORT / LUCKYSTACK_ENV / LUCKYSTACK_PRESET — see ARCHITECTURE_MULTI_INSTANCE.md).');
  return ok();
};

export const removeRouter = (project: ConsumerProject): Result<void> => {
  try {
    if (dropScript(project, 'router')) console.log('• removed the `router` npm script');
    if (dropDependency(project, PKG)) console.log(`• removed ${PKG} from package.json`);
    else console.log(`• ${PKG} was not in package.json`);
  } catch (error) {
    return err(toError(error));
  }
  return ok();
};
