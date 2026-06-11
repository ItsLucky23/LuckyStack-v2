//? `luckystack add login` — installs the auth BACKEND (@luckystack/login, which
//? self-wires session + OAuth-by-env via its `./register` subpath on restart) AND
//? copies the editable, consumer-owned auth UI into `src/`: the `/login`,
//? `/register`, `/reset-password`, `/settings/**` pages + their `_api` handlers +
//? `LoginForm`. These are file-routed (main.tsx auto-discovers `src/**/page.tsx`),
//? so no router edits are needed — only a file copy. Copies are skip-if-exists so
//? re-running never clobbers a page you've already customized (shadcn-style).

import path from 'node:path';
import {
  addDependency,
  assetPath,
  copyDirIfAbsent,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

export const addLogin = (project: ConsumerProject, options: AddOptions): Result<void> => {
  //? Copy the auth UI bundle into the consumer's src/ (idempotent).
  let written: string[];
  try {
    written = copyDirIfAbsent(assetPath('login', 'src'), path.join(project.root, 'src'));
  } catch (error) {
    return err(error as Error);
  }
  if (written.length > 0) {
    console.log(`• copied ${String(written.length)} auth file(s) into src/ (login / register / reset-password / settings + LoginForm)`);
    for (const file of written) {
      console.log(`    ${path.relative(project.root, file)}`);
    }
  } else {
    console.log('• auth UI already present in src/ — skipped copy (kept your edits).');
  }

  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  if (addDependency(project, '@luckystack/login', range)) {
    console.log(`• added @luckystack/login@${range} to package.json`);
  }

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log('\n✓ login added. Restart the server. The auth backend self-wires from env');
  console.log('  (set DEV_<PROVIDER>_CLIENT_ID/SECRET to enable an OAuth provider; the');
  console.log('  login form learns active providers from GET /auth/providers).');
  console.log('  For framework-mode forgot-password / email-change, also: npx luckystack add email');
  return ok();
};
