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
import { collectSourceFiles, matchAll } from '../lib/scan';
import type { RegistryEntry } from '../registry';

//? After a removal, the package is gone from package.json but the consumer's OWN
//? code may still import it (handlers using @luckystack/email, a page importing
//? @luckystack/login, etc.) — those break at build time until cleaned up. Scan the
//? source for any string literal that is the package or a subpath (covers
//? `import … from`, dynamic `import()`, `require()`) and print the file:line list
//? so the user can fix them — or hand the list straight to an AI. Read-only.
const referencesToPackage = (root: string, pkg: string): string[] => {
  const escaped = pkg.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = new RegExp(`['"](${escaped}(?:/[^'"]*)?)['"]`, 'g');
  return matchAll(collectSourceFiles(root), pattern).map((hit) => `${hit.file}:${String(hit.line)}`);
};

const warnRemainingReferences = (root: string, pkg: string): void => {
  const refs = referencesToPackage(root, pkg);
  if (refs.length === 0) return;
  console.warn(`\n⚠ ${String(refs.length)} reference(s) to ${pkg} remain in your code — these will break until you remove or replace them:`);
  for (const ref of refs) console.warn(`    ${ref}`);
  console.warn('  Tip: hand this list to your AI (or grep it) to clean up the imports/usages.');
};

const MAIN_TSX = 'src/main.tsx';
const TEMPLATE_PROVIDER = 'src/_components/templates/TemplateProvider.tsx';
const CONFIG_TS = 'config.ts';
const README = 'README.md';
const DOCS_PAGE = 'src/docs/page.tsx';

//? README paragraphs that describe login as an INSTALLED feature. Mirror of
//? create-luckystack-app's LOGIN_DOC_EDITS so removing login here strips the same
//? prose the scaffold would never have emitted for an auth:'none' project. The
//? auth-pages paragraph is replaced with a neutral "add it later" pointer (the
//? @luckystack/login package still exists as an option); the rest are deleted.
const LOGIN_DOC_EDITS = [
  {
    find: "If you selected an **auth** mode (`credentials` / `credentials+oauth`), you'll also find the auth UI under `src/`: `login/page.tsx`, `register/page.tsx`, `reset-password/page.tsx`, and an account-management `settings/page.tsx`. Scaffolded with `auth: 'none'`? Add them later with `npx luckystack add login`.",
    replace: "Want auth (login / register / account pages)? This project has none yet — add it anytime with `npx luckystack add login`.",
  },
  {
    find: "Selecting an **auth** mode also adds the auth-related API handlers — e.g. `logout_v1`, the `reset-password/_api/*` reset flow, and the `settings/_api/*` session / password / profile / account handlers. These ship alongside the auth pages above (and arrive together via `npx luckystack add login`).\n\n",
    replace: '',
  },
  {
    find: "If you selected an **auth** mode, `LoginForm.tsx` (the credentials + OAuth form used by `/login` and `/register`) is here too.\n\n",
    replace: '',
  },
  {
    find: "With an **auth** mode selected, OAuth providers auto-wire from env at boot (set the vars in `.env.local`; no file needed), the user adapter self-wires via `defaultPrismaUserAdapter` (override with `registerUserAdapter()` in `luckystack/server/index.ts`), and `server/hooks/notifications.ts` wires the transactional new-sign-in / password-change emails.\n\n",
    replace: '',
  },
];

//? Best-effort: strip each login section from the consumer's README, applying the
//? edits one at a time so a paragraph the user hand-edited (token miss = editFile
//? throws) is skipped + reported rather than aborting the whole removal. Doc
//? cleanup must never be able to fail a package removal.
export const pruneLoginDocs = (root: string): void => {
  const readmePath = path.join(root, README);
  if (!fs.existsSync(readmePath)) return;
  let stripped = 0;
  let missed = 0;
  for (const edit of LOGIN_DOC_EDITS) {
    try {
      editFile(readmePath, [edit]);
      stripped += 1;
    } catch {
      missed += 1;
    }
  }
  if (stripped > 0) console.log(`• removed ${String(stripped)} login section(s) from README.md`);
  if (missed > 0) {
    console.warn(`⚠ ${String(missed)} README login section(s) looked hand-edited — left untouched; review README.md for stale login docs.`);
  }
};

//? Inverse of addPresence's `enablePresenceFlags`: flip the three presence gating
//? flags back to `false` so a removed presence leaves no live broadcaster/indicator
//? wiring behind. Tokens mirror the template config.ts lines; `editFile` throws on a
//? miss (drifted config) — the desired loud-fail, converted to a Result by the caller.
const disablePresenceFlags = (configPath: string): Result<void> => {
  try {
    editFile(configPath, [
      { find: 'socketActivityBroadcaster: true,', replace: 'socketActivityBroadcaster: false,' },
      { find: 'socketStatusIndicator: true,', replace: 'socketStatusIndicator: false,' },
      { find: 'locationProviderEnabled: true,', replace: 'locationProviderEnabled: false,' },
    ]);
  } catch (error) {
    return err(error as Error);
  }
  return ok();
};

//? The consumer-owned auth files `add login` copies into src/. The SINGLE source of
//? truth for the auth-UI file set: `remove login` (guarded) LISTS them; the
//? reconfigure→none path (transitions.ts) DELETES them — both import this so the two
//? can never drift (ADR 0014 D2).
export const LOGIN_COPIED_PATHS = [
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
    if (!reversed.ok) {
      //? A token-miss here means the consumer hand-edited the injected presence
      //? mounts. We refuse to guess — nothing is changed (dep still present). Tell
      //? them how to finish by hand instead of leaving a cryptic token error.
      return err(new Error(
        `${reversed.error.message}\n\n` +
        '  This usually means you edited the presence client code, so the CLI can\'t\n' +
        '  safely auto-revert it. Nothing was changed. To remove presence by hand:\n' +
        `    1. in ${MAIN_TSX}: remove the @luckystack/presence/client import and put\n` +
        '       the router root element back to <Outlet />.\n' +
        `    2. in ${TEMPLATE_PROVIDER}: remove the <SocketStatusIndicator/> block + its\n` +
        '       useSocketStatus import.\n' +
        '    3. drop "@luckystack/presence" from package.json, then npm install.',
      ));
    }
    console.log('• reverted <LocationProvider/> (main.tsx) + <SocketStatusIndicator/> (TemplateProvider.tsx)');
  } else {
    console.log('• presence client mounts already absent — skipped JSX revert.');
  }

  //? Flip the three presence gating flags back to `false` (inverse of addPresence).
  //? Only act when the enabled flag is actually present (`: true,`) — a config.ts
  //? that never had them stays untouched (no hard-fail). Fails loud on partial
  //? drift via `disablePresenceFlags`.
  const configPath = path.join(project.root, CONFIG_TS);
  if (fs.existsSync(configPath) && fs.readFileSync(configPath, 'utf8').includes('socketActivityBroadcaster: true,')) {
    const flagged = disablePresenceFlags(configPath);
    if (!flagged.ok) return flagged;
    console.log('• disabled socketActivityBroadcaster / socketStatusIndicator / locationProviderEnabled in config.ts');
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

//? Remove docs-ui: delete the React API-explorer page `add docs-ui` copied into
//? src/, then drop the dependency. Inverse of addDocsUi. The generated
//? `apiDocs.generated.json` is a gitignored build artifact (regenerated by
//? generateArtifacts), so it is left alone. Unlike login, the explorer is not a
//? bespoke consumer surface, so removal deletes it outright (the user asked for
//? `remove` to fully reverse `add`).
const removeDocsUi = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  const pagePath = path.join(project.root, DOCS_PAGE);
  try {
    if (fs.existsSync(pagePath)) {
      fs.rmSync(pagePath, { force: true });
      console.log(`• removed ${DOCS_PAGE} (the API explorer page)`);
    } else {
      console.log(`• ${DOCS_PAGE} not present — nothing to remove`);
    }
    if (dropDependency(project, entry.pkg)) {
      console.log(`• removed ${entry.pkg} from package.json`);
    } else {
      console.log(`• ${entry.pkg} was not in package.json`);
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

  //? Scrub login-as-installed prose from the README (best-effort, never aborts).
  pruneLoginDocs(project.root);

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
//? all add/remove handlers, so removal handlers never install themselves. On
//? success, scan for any of the consumer's own remaining imports of the package
//? (the JSX/copied-file handling above is package-managed; THIS catches the user's
//? own usages that now dangle) and print them so they can be cleaned up.
export const removeFeature = (project: ConsumerProject, entry: RegistryEntry): Result<void> => {
  const result = ((): Result<void> => {
    switch (entry.kind) {
      case 'login': {
        return removeLogin(project, entry);
      }
      case 'presence': {
        return removePresence(project, entry);
      }
      case 'docs-ui': {
        return removeDocsUi(project, entry);
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
  })();
  if (result.ok) warnRemainingReferences(project.root, entry.pkg);
  return result;
};
