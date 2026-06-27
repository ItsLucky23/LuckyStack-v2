//? `luckystack add router` / `remove` — mirror of the scaffolder's `wireRouter`:
//? @luckystack/router is a multi-instance load-balancer that runs as a SEPARATE
//? process (`npm run router`) reading the project's deploy.config.ts. Because the
//? router topology files (services.config.ts + deploy.config.ts + the build-time
//? server/config/presetLoader.ts) are NOT shipped in a base install, `add` ALSO
//? copies them in + wires their two side-effect imports into server/server.ts;
//? `remove` deletes them again + un-wires the imports. A single-instance app never
//? runs the router — this just makes scaling out later `npm run router`, no rewiring.

import fs from 'node:fs';
import path from 'node:path';
import {
  addDependency,
  dropDependency,
  setScript,
  dropScript,
  copyDirIfAbsent,
  assetPath,
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

const PKG = '@luckystack/router';

//? Project-root-relative paths of the topology files the router needs. Order is
//? irrelevant for deletion; copy is handled wholesale by copyDirIfAbsent.
const ROUTER_CONFIG_FILES = [
  'services.config.ts',
  'deploy.config.ts',
  path.join('server', 'config', 'presetLoader.ts'),
];

const SERVER_ENTRY = path.join('server', 'server.ts');
//? Anchor: the project-config side-effect import that EVERY scaffold's server.ts
//? has. The router's two imports go directly after it (config first, then deploy/
//? services — matching the documented overlay order).
const CONFIG_IMPORT = "import '../config';\n";
const ROUTER_IMPORTS = "import '../deploy.config';\nimport '../services.config';\n";

const wireServerImports = (project: ConsumerProject): void => {
  const serverPath = path.join(project.root, SERVER_ENTRY);
  if (!fs.existsSync(serverPath)) {
    console.warn(
      `• ${SERVER_ENTRY} not found — add the router config imports manually under \`import '../config';\`:\n` +
      "    import '../deploy.config';\n    import '../services.config';",
    );
    return;
  }
  const content = fs.readFileSync(serverPath, 'utf8').replaceAll('\r\n', '\n');
  if (content.includes("import '../deploy.config'") || content.includes("import '../services.config'")) {
    console.log(`• ${SERVER_ENTRY} already imports the router config`);
    return;
  }
  editFile(serverPath, [{ find: CONFIG_IMPORT, replace: CONFIG_IMPORT + ROUTER_IMPORTS }]);
  console.log(`• wired deploy.config + services.config imports into ${SERVER_ENTRY}`);
};

const unwireServerImports = (project: ConsumerProject): void => {
  const serverPath = path.join(project.root, SERVER_ENTRY);
  if (!fs.existsSync(serverPath)) return;
  const content = fs.readFileSync(serverPath, 'utf8').replaceAll('\r\n', '\n');
  if (!content.includes("import '../deploy.config'") && !content.includes("import '../services.config'")) return;
  try {
    editFile(serverPath, [{ find: ROUTER_IMPORTS, replace: '' }]);
    console.log(`• removed deploy.config + services.config imports from ${SERVER_ENTRY}`);
  } catch {
    console.warn(
      `• couldn't auto-remove the router config imports from ${SERVER_ENTRY} (file drifted) — remove these two lines manually:\n` +
      "    import '../deploy.config';\n    import '../services.config';",
    );
  }
};

export const addRouter = (project: ConsumerProject, options: AddOptions): Result<void> => {
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, PKG, range)) console.log(`• added ${PKG}@${range} to package.json`);
    else console.log(`• ${PKG} already in package.json`);
    if (setScript(project, 'router', 'luckystack-router')) console.log("• added the `router` npm script (npm run router)");
    else console.log("• 'router' npm script already present");

    //? Copy the topology files (idempotent — never clobbers a config the user has
    //? already edited) + wire their imports into server/server.ts.
    const written = copyDirIfAbsent(assetPath('router'), project.root);
    if (written.length > 0) {
      console.log(`• added router config: ${written.map((w) => path.relative(project.root, w)).join(', ')}`);
    } else {
      console.log('• router config files already present');
    }
    wireServerImports(project);
  } catch (error) {
    return err(toError(error));
  }
  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) console.warn('  npm install failed — run it manually to finish.');
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }
  console.log('\n✓ router added. Topology lives in deploy.config.ts + services.config.ts.');
  console.log('  Single-instance prod still works (bare `npm run server`); scale out by adding');
  console.log('  per-service bindings + presets, then start the balancer with `npm run router`');
  console.log('  (env: ROUTER_PORT / LUCKYSTACK_ENV — see ARCHITECTURE_MULTI_INSTANCE.md).');
  return ok();
};

export const removeRouter = (project: ConsumerProject): Result<void> => {
  try {
    if (dropScript(project, 'router')) console.log('• removed the `router` npm script');
    if (dropDependency(project, PKG)) console.log(`• removed ${PKG} from package.json`);
    else console.log(`• ${PKG} was not in package.json`);

    //? Un-wire the server imports BEFORE deleting the files so a drifted server.ts
    //? is reported while the files still exist to point at.
    unwireServerImports(project);
    for (const rel of ROUTER_CONFIG_FILES) {
      const abs = path.join(project.root, rel);
      if (fs.existsSync(abs)) {
        fs.rmSync(abs);
        console.log(`• removed ${rel}`);
      }
    }
  } catch (error) {
    return err(toError(error));
  }
  return ok();
};
