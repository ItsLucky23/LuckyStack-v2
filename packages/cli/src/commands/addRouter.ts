//? `luckystack add router` / `remove` — mirror of the scaffolder's `wireRouter`:
//? @luckystack/router is a multi-instance load-balancer that runs as a SEPARATE
//? process (`npm run router`) reading the project's deploy.config.ts. Because the
//? router topology files (services.config.ts + deploy.config.ts + the build-time
//? server/config/presetLoader.ts) are NOT shipped in a base install, `add` ALSO
//? copies them in + wires their two side-effect imports into server/server.ts;
//? `remove` deletes the unedited ones again (edited ones are kept + listed) and
//? un-wires the imports. A single-instance app never runs the router — this just
//? makes scaling out later `npm run router`, no rewiring.

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
import { splitShippedFiles } from '../lib/shippedFiles';

const PKG = '@luckystack/router';

//? Project-root-relative (posix, to match manifest + asset paths) topology files
//? the router needs. Copy is handled wholesale by copyDirIfAbsent.
const PRESET_LOADER = 'server/config/presetLoader.ts';
const ROUTER_CONFIG_FILES = ['services.config.ts', 'deploy.config.ts', PRESET_LOADER];

const SERVER_ENTRY = path.join('server', 'server.ts');
//? Anchor: the project-config side-effect import that EVERY scaffold's server.ts
//? has. The router's two imports go directly after it (config first, then deploy/
//? services — matching the documented overlay order).
const CONFIG_IMPORT = "import '../config';\n";
const ROUTER_IMPORTS = "import '../deploy.config';\nimport '../services.config';\n";
const SOCKET_INVOCATION = "invocation: 'socket' as 'socket' | 'routed-http',";
const ROUTED_INVOCATION = "invocation: 'routed-http' as 'socket' | 'routed-http',";

export const setInvocationTransport = (
  project: ConsumerProject,
  from: string,
  to: string,
): void => {
  const configPath = path.join(project.root, 'config.ts');
  if (!fs.existsSync(configPath)) {
    console.warn(`• config.ts not found — set transport.invocation to '${to.includes('routed-http') && to !== SOCKET_INVOCATION ? 'routed-http' : 'socket'}' manually`);
    return;
  }
  const content = fs.readFileSync(configPath, 'utf8');
  if (content.includes(to)) return;
  if (!content.includes(from)) {
    console.warn('• config.ts transport block drifted — update transport.invocation manually');
    return;
  }
  editFile(configPath, [{ find: from, replace: to }]);
};

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
    setInvocationTransport(project, SOCKET_INVOCATION, ROUTED_INVOCATION);
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
    setInvocationTransport(project, ROUTED_INVOCATION, SOCKET_INVOCATION);
    //? The add message tells the user to edit these files (topology lives in
    //? deploy.config.ts), and the registry promises a 'safe' removal touches no
    //? user-owned file — so only unedited shipped copies go. An edited preset
    //? loader imports the other two, so keeping it keeps them as well.
    const present = ROUTER_CONFIG_FILES.filter((rel) => fs.existsSync(path.join(project.root, rel)));
    const split = splitShippedFiles(project.root, present, assetPath('router'));
    const kept = split.kept.includes(PRESET_LOADER) ? present : split.kept;
    for (const rel of present.filter((file) => !kept.includes(file))) {
      fs.rmSync(path.join(project.root, rel));
      console.log(`• removed ${rel}`);
    }
    if (kept.length > 0) {
      console.warn('⚠ kept router config you edited (not deleted — delete it yourself once you no longer need it):');
      for (const rel of kept) console.warn(`    ${rel}`);
    }
  } catch (error) {
    return err(toError(error));
  }
  return ok();
};
