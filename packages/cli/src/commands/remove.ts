//? `luckystack remove`/`manage` removal handlers — the inverse of the add path.
//? Each mirrors a create-luckystack-app pruner so add+remove round-trip cleanly:
//?   - backend : drop the dependency line (it self-wired by mere presence).
//?   - presence: drop the dep + REVERSE the client JSX mounts (prunePresence).
//?   - login   : GUARDED — drop the dep but KEEP the consumer-owned auth UI the
//?               `add` copied (the user may have edited it) + warn what to delete.
//? File edits go through `editFile`, which throws on a missing token, so a
//? hand-edited (drifted) file fails LOUD instead of corrupting the source.

import fs from 'node:fs';
import path from 'node:path';
import {
  dropDependency,
  editFile,
  err,
  ok,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { RegistryEntry } from '../registry';

const MAIN_TSX = 'src/main.tsx';
const TEMPLATE_PROVIDER = 'src/_components/templates/TemplateProvider.tsx';

//? The consumer-owned auth files `add login` copies into src/. Removal keeps them
//? (they may be edited) — we only LIST them so the user can delete by hand.
const LOGIN_COPIED_PATHS = [
  'src/login',
  'src/register',
  'src/reset-password',
  'src/settings',
  'src/_components/LoginForm.tsx',
] as const;

//? Reverse the presence client mounts (mirror of create-luckystack-app's
//? prunePresence): main.tsx swaps <LocationProvider/> back to <Outlet/>;
//? TemplateProvider.tsx drops <SocketStatusIndicator/> + the wiring it needed.
//? Each `editFile` is atomic + throws on a missing token, converted to a Result.
const reversePresenceEdits = (mainPath: string, templateProviderPath: string): Result<void> => {
  try {
    editFile(mainPath, [
      {
        find: "import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';",
        replace: "import { createBrowserRouter, RouterProvider, useParams, useSearchParams, Outlet } from 'react-router-dom';",
      },
      { find: "import { LocationProvider } from '@luckystack/presence/client';\n", replace: '' },
      { find: 'element: <LocationProvider />,', replace: 'element: <Outlet />,' },
    ]);

    editFile(templateProviderPath, [
      { find: "import { SocketStatusIndicator } from '@luckystack/presence/client';\n", replace: '' },
      {
        find: "import { useTheme, useSession, useTranslator } from '@luckystack/core/client';",
        replace: "import { useTheme, useSession } from '@luckystack/core/client';",
      },
      { find: "import { useSocketStatus } from 'src/_providers/socketStatusProvider';\n", replace: '' },
      { find: '  const { socketStatus } = useSocketStatus();\n', replace: '' },
      { find: '  const translate = useTranslator();\n', replace: '' },
      {
        find:
          "      <SocketStatusIndicator\n" +
          '        status={socketStatus.self.status}\n' +
          '        reconnectAttempt={socketStatus.self.reconnectAttempt}\n' +
          "        label={translate({ key: 'template.socketStatus' })}\n" +
          '      />\n',
        replace: '',
      },
    ]);
  } catch (error) {
    return err(error as Error);
  }
  return ok();
};

//? Drop a backend-only package: just remove the dependency line. It self-wired by
//? mere presence (`./register` subpath or the sync client bridge), so deleting the
//? dep + reinstalling is the complete removal.
const removeBackend = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  try {
    if (dropDependency(project, entry.pkg)) {
      console.log(`• removed ${entry.pkg} from package.json`);
    } else {
      console.log(`• ${entry.pkg} was not in package.json — nothing to remove`);
    }
  } catch (error) {
    return err(error as Error);
  }
  return ok();
};

//? Remove presence: reverse the client JSX mounts, THEN drop the dependency.
//? Order mirrors the add path's inverse — a token-miss aborts before package.json
//? changes, preserving the "command failed ⇒ nothing changed" invariant.
const removePresence = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  const mainPath = path.join(project.root, MAIN_TSX);
  const templateProviderPath = path.join(project.root, TEMPLATE_PROVIDER);

  if (!fs.existsSync(mainPath) || !fs.existsSync(templateProviderPath)) {
    return err(new Error(
      `Could not find ${MAIN_TSX} and ${TEMPLATE_PROVIDER} — is this a LuckyStack project with the default client layout?`,
    ));
  }

  //? Idempotency: if the LocationProvider mount is already gone, the JSX is
  //? already reversed (or presence was never client-wired). Skip the edits but
  //? still drop the dependency.
  const mainStillWired = fs.readFileSync(mainPath, 'utf8').includes('@luckystack/presence/client');
  if (mainStillWired) {
    const reversed = reversePresenceEdits(mainPath, templateProviderPath);
    if (!reversed.ok) return reversed;
    console.log('• reverted <LocationProvider/> (main.tsx) + <SocketStatusIndicator/> (TemplateProvider.tsx)');
  } else {
    console.log('• presence client mounts already absent — skipped JSX revert.');
  }

  try {
    if (dropDependency(project, entry.pkg)) {
      console.log(`• removed ${entry.pkg} from package.json`);
    }
  } catch (error) {
    return err(error as Error);
  }
  return ok();
};

//? Remove login: GUARDED. Drop the dependency but NEVER delete the auth UI the
//? `add` copied into src/ — the user may have customized it (shadcn-style). Print
//? a clear warning listing the files they can delete manually if they want to.
//? `--force` is intentionally NOT auto-deleting here: keeping user-owned files is
//? the safe default; deletion stays a manual, deliberate act.
const removeLogin = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  try {
    if (dropDependency(project, entry.pkg)) {
      console.log(`• removed ${entry.pkg} from package.json`);
    } else {
      console.log(`• ${entry.pkg} was not in package.json`);
    }
  } catch (error) {
    return err(error as Error);
  }

  console.warn('\n⚠ login removed from package.json, but the auth UI copied into src/ was KEPT');
  console.warn('  (you may have edited it). Delete these by hand if you no longer want them:');
  for (const rel of LOGIN_COPIED_PATHS) {
    if (fs.existsSync(path.join(project.root, rel))) {
      console.warn(`    ${rel}`);
    }
  }
  return ok();
};

//? Dispatch a removal by registry kind. Install is run ONCE by the caller after
//? all add/remove handlers, so removal handlers never install themselves.
export const removeFeature = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  switch (entry.kind) {
    case 'login': {
      return removeLogin(project, entry);
    }
    case 'presence': {
      return removePresence(project, entry);
    }
    case 'backend': {
      return removeBackend(project, entry);
    }
    default: {
      //? Exhaustiveness guard — a new FeatureKind without a case is a compile error.
      const _exhaustive: never = entry.kind;
      throw new Error(`Unhandled feature kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
