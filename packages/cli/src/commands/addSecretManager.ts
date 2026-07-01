//? `luckystack add secret-manager` / `remove` — mirror of the scaffolder's
//? `wireSecretManager`: adds @luckystack/secret-manager AND uncomments the three
//? enable-later blocks the template ships (the `secretManager` slot in config.ts,
//? the `initSecretManager` block in server/server.ts, and the identical block in
//? scripts/prismaWithSecrets.ts so the `prisma:*` scripts resolve pointers). It stays dormant until
//? LUCKYSTACK_SECRET_MANAGER_URL is set, so the project still boots without an
//? external secret server. Remove re-comments both blocks + drops the dep.
//? Edits are best-effort (idempotent): a project already in the target shape skips.

import fs from 'node:fs';
import path from 'node:path';
import {
  addDependency,
  dropDependency,
  editFile,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  toError,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

const PKG = '@luckystack/secret-manager';

const CONFIG_COMMENTED = `  // secretManager: {
  //   url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
  //   token: { fromFile: '.secret-manager-token' },
  // },`;

//? Byte-identical to the scaffolder's wireSecretManager replacement (create-
//? luckystack-app/src/index.ts) so `add secret-manager` produces the SAME block a
//? `--secret-manager` scaffold does — AND so `removeSecretManager` (which matches
//? this verbatim) can re-comment a scaffolder-wired project too, not just a
//? CLI-added one. The "secret-manager block parity" test in assetParity.test.ts
//? guards it (asserts the scaffolder source contains these blocks verbatim), so a
//? scaffolder-side edit that would break `remove`/manage→off trips CI.
const CONFIG_ACTIVE = `  secretManager: {
    url: env('LUCKYSTACK_SECRET_MANAGER_URL') ?? '',
    token: { fromFile: '.secret-manager-token' },
    //? Which \`.env\` names are eligible for off-host resolution. The package's
    //? secure default (omitting this) resolves NOTHING — so the scaffold opts in
    //? to resolving every pointer-shaped (\`NAME=BASE_V<n>\`) value here, which is
    //? what "install secret-manager → it just works" expects. To restrict, replace
    //? \`() => true\` with an allowlist array of names, e.g. \`['OPENAI_KEY', 'DB_URL']\`.
    envNames: () => true,
  },`;

const SERVER_COMMENTED = `  // const projectConfig = (await import('../config')).default;
  // if (projectConfig.secretManager?.url) {
  //   const sm = await import('@luckystack/secret-manager');
  //   await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  // }`;

const SERVER_ACTIVE = `  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }`;

const tryEdit = (root: string, rel: string, find: string, replace: string): boolean => {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return false;
  try {
    editFile(file, [{ find, replace }]);
    return true;
  } catch {
    return false;
  }
};

export const addSecretManager = (project: ConsumerProject, options: AddOptions): Result<void> => {
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, PKG, range)) console.log(`• added ${PKG}@${range} to package.json`);
    else console.log(`• ${PKG} already in package.json`);
  } catch (error) {
    return err(toError(error));
  }
  if (tryEdit(project.root, 'config.ts', CONFIG_COMMENTED, CONFIG_ACTIVE)) {
    console.log('• uncommented the secretManager block in config.ts (envNames: () => true)');
  }
  if (tryEdit(project.root, 'server/server.ts', SERVER_COMMENTED, SERVER_ACTIVE)) {
    console.log('• uncommented the initSecretManager block in server/server.ts');
  }
  //? Same enable-later block lives in scripts/prismaWithSecrets.ts so the
  //? `prisma:*` scripts resolve DATABASE_URL pointers before running prisma.
  if (tryEdit(project.root, 'scripts/prismaWithSecrets.ts', SERVER_COMMENTED, SERVER_ACTIVE)) {
    console.log('• uncommented the secret-resolution block in scripts/prismaWithSecrets.ts');
  }
  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) console.warn('  npm install failed — run it manually to finish.');
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }
  console.log(`\n✓ secret-manager added. Set LUCKYSTACK_SECRET_MANAGER_URL (+ .secret-manager-token) to`);
  console.log('  resolve `NAME=BASE_V<n>` pointers off-host; dormant until the URL is set.');
  return ok();
};

export const removeSecretManager = (project: ConsumerProject): Result<void> => {
  //? Re-comment the blocks BEFORE dropping the dep (server/server.ts imports the
  //? package dynamically only when the block is active, but re-commenting keeps the
  //? source clean + matches the no-secret-manager scaffold shape).
  //? Known non-atomicity: if dropDependency throws (EACCES, etc.) the config files
  //? have already been re-commented but package.json is unchanged. On retry the
  //? tryEdit calls will be no-ops (token already gone), so the dep can be cleanly
  //? dropped on the next attempt. A full rollback would require saving old file
  //? content before editing — not implemented.
  if (tryEdit(project.root, 'config.ts', CONFIG_ACTIVE, CONFIG_COMMENTED)) {
    console.log('• re-commented the secretManager block in config.ts');
  }
  if (tryEdit(project.root, 'server/server.ts', SERVER_ACTIVE, SERVER_COMMENTED)) {
    console.log('• re-commented the initSecretManager block in server/server.ts');
  }
  if (tryEdit(project.root, 'scripts/prismaWithSecrets.ts', SERVER_ACTIVE, SERVER_COMMENTED)) {
    console.log('• re-commented the secret-resolution block in scripts/prismaWithSecrets.ts');
  }
  try {
    if (dropDependency(project, PKG)) console.log(`• removed ${PKG} from package.json`);
    else console.log(`• ${PKG} was not in package.json`);
  } catch (error) {
    return err(toError(error));
  }
  return ok();
};
