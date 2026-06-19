//? `luckystack add login` — installs the auth BACKEND (@luckystack/login, which
//? self-wires session + OAuth-by-env via its `./register` subpath on restart) AND
//? reproduces what an auth-mode scaffold ships, so the result actually WORKS:
//?   - copies the editable consumer-owned auth surface into the project (skip-if-
//?     exists): the /login,/register,/reset-password,/settings pages + their _api
//?     handlers + LoginForm + the `functions/session.ts` shim (exposes
//?     `functions.session.*` in every handler — the _api handlers need it) +
//?     `server/hooks/notifications.ts` (sign-in / password-change emails).
//?   - restores config.ts auth flags an `auth: 'none'` scaffold disabled
//?     (credentials:false → true, forgotPassword:'disabled' → 'framework').
//?   - registers the notification hooks in luckystack/server/index.ts.
//? The config + server edits are BEST-EFFORT: a project already in the auth shape
//? (or one the user customized) simply skips them rather than failing the add.

import fs from 'node:fs';
import path from 'node:path';
import {
  addDependency,
  assetPath,
  copyDirIfAbsent,
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

//? The auth-hooks block a credentials scaffold ships in luckystack/server/index.ts.
//? Mirror of the scaffolder's pre-prune content (so add+prune are inverse).
export const AUTH_SERVER_HOOKS = `import { registerHook } from '@luckystack/core';
import { registerNotificationHooks } from '../../server/hooks/notifications';

//? Wires the transactional notification hooks (new sign-in email,
//? password-change email). Reads \`user.preferences\` to respect opt-in. Safe
//? to leave on even if @luckystack/email isn't installed — the email
//? sender no-ops with \`{ ok: false, reason: 'no-sender' }\`.
registerNotificationHooks();

//? Example dev-only logger — delete or replace with your own audit hook.
registerHook('postLogin', ({ userId, provider, isNewUser }) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(\`[hooks] login: user=\${userId}, provider=\${provider}, new=\${String(isNewUser)}\`);
  }
  return undefined;
});`;

export const AUTH_NONE_SERVER_PLACEHOLDER = `//? authMode 'none': no auth hooks to register. Add your own framework-hook
//? registrations here (this overlay is auto-imported at boot, after every
//? other overlay file).
export {};`;

//? Best-effort file edit: returns whether it applied. A token-miss means the file
//? is already in the target shape (or the user customized it) — skip, don't fail.
const tryEdit = (filePath: string, find: string, replace: string): boolean => {
  if (!fs.existsSync(filePath)) return false;
  try {
    editFile(filePath, [{ find, replace }]);
    return true;
  } catch {
    return false;
  }
};

export const addLogin = (project: ConsumerProject, options: AddOptions): Result<void> => {
  //? Copy the WHOLE auth bundle (src/ UI + functions/session.ts + server/hooks)
  //? into the project (idempotent, skip-if-exists so consumer edits are kept).
  //? IMPORTANT: the list of files/dirs this copies is the authoritative surface that
  //? `remove login` (LOGIN_COPIED_PATHS in remove.ts) must delete to stay symmetric.
  //? If you add a file to assets/login/, also add it to LOGIN_COPIED_PATHS in remove.ts.
  let written: string[];
  try {
    written = copyDirIfAbsent(assetPath('login'), project.root);
  } catch (error) {
    return err(toError(error));
  }
  if (written.length > 0) {
    console.log(`• copied ${String(written.length)} auth file(s) into the project (pages + _api + LoginForm + functions/session.ts + server/hooks/notifications.ts)`);
  } else {
    console.log('• auth files already present — skipped copy (kept your edits).');
  }

  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDependency(project, '@luckystack/login', range)) {
      console.log(`• added @luckystack/login@${range} to package.json`);
    }
  } catch (error) {
    return err(toError(error));
  }

  //? Re-enable auth in config.ts if an `auth: 'none'` scaffold had disabled it.
  const configRestored = tryEdit(
    path.join(project.root, 'config.ts'),
    `  auth: {
    //? authMode 'none': no built-in auth UI/flows are scaffolded.
    forgotPassword: 'disabled',
    credentials: false,
  },`,
    `  auth: {
    forgotPassword: 'framework',
    credentials: true,
  },`,
  );
  if (configRestored) console.log("• re-enabled auth in config.ts (credentials: true, forgotPassword: 'framework')");

  //? Register the notification hooks in the server overlay (reverse of the prune).
  const hooksWired = tryEdit(
    path.join(project.root, 'luckystack', 'server', 'index.ts'),
    AUTH_NONE_SERVER_PLACEHOLDER,
    AUTH_SERVER_HOOKS,
  );
  if (hooksWired) console.log('• registered notification hooks in luckystack/server/index.ts');

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log('\n✓ login added. Restart the server + run `npm run generateArtifacts`. The auth backend self-wires');
  console.log('  from env (set DEV_<PROVIDER>_CLIENT_ID/SECRET to enable an OAuth provider; add the');
  console.log('  provider origin to EXTERNAL_ORIGINS in .env, or use `npx luckystack manage` → Auth).');
  console.log('  For framework-mode forgot-password / email-change, also: npx luckystack add email');
  //? Page-load ROUTE GUARDS are consumer-owned and NOT auto-edited (a scaffold with
  //? auth:none routes '/' → /dashboard and leaves the dashboard ungated). Surfacing
  //? this so a developer doesn't ship an unauthenticated dashboard unknowingly.
  console.log('\n⚠ Route guards are not auto-wired. If you want auth-gated routing, add a page guard:');
  console.log('    • src/dashboard/page.tsx: export const middleware = ({ session }) => session');
  console.log('        ? { success: true } : { success: false, redirect: \'/login\' };');
  console.log('    • src/page.tsx: redirect \'/\' to /login (or your entry) when there\'s no session.');
  console.log('  See docs/luckystack/LUCKYSTACK_ADD_GUIDE.md (add login → route guards).');
  return ok();
};
