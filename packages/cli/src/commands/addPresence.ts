//? `luckystack add presence` — the inverse of create-luckystack-app's presence
//? pruner. Re-adds the @luckystack/presence dependency and the consumer-`src/`
//? JSX mounts a plain `npm i` can't inject: `<LocationProvider/>` as the router
//? root in `main.tsx` and `<SocketStatusIndicator/>` in `TemplateProvider.tsx`.
//? (The server-side presence lifecycle already auto-wires via
//? `@luckystack/presence/register` on bare `npm i` — this command only adds the
//? CLIENT mount points Vite cannot statically import when absent.)

import fs from 'node:fs';
import path from 'node:path';
import { addDependency, editFile, err, ok, resolveLuckyStackRange, runNpmInstall, type ConsumerProject, type Result } from '../lib/project';

export interface AddOptions {
  install: boolean;
  cliVersion: string;
}

const MAIN_TSX = 'src/main.tsx';
const TEMPLATE_PROVIDER = 'src/_components/templates/TemplateProvider.tsx';

//? Reverse the pruner's edits in main.tsx + TemplateProvider.tsx. `editFile`
//? throws on a missing token (drifted template); we convert that into a returned
//? Result so the CLI entry reports it cleanly instead of crashing with a stack
//? trace. `editFile` writes each file atomically, so a throw can't half-edit it.
const applyPresenceEdits = (mainPath: string, templateProviderPath: string): Result<void> => {
  try {
    editFile(mainPath, [
      {
        find: "import { createBrowserRouter, RouterProvider, useParams, useSearchParams, Outlet } from 'react-router-dom';",
        replace: "import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';",
      },
      {
        find: "import type { PageMiddleware } from '@luckystack/core/client';",
        replace: "import type { PageMiddleware } from '@luckystack/core/client';\nimport { LocationProvider } from '@luckystack/presence/client';",
      },
      { find: 'element: <Outlet />,', replace: 'element: <LocationProvider />,' },
    ]);

    //? TemplateProvider.tsx — reverse the pruner's edits, ordered so anchors
    //? exist when each insert runs.
    editFile(templateProviderPath, [
      {
        find: "import { useTheme, useSession } from '@luckystack/core/client';",
        replace: "import { useTheme, useSession, useTranslator } from '@luckystack/core/client';",
      },
      {
        find: "import { useTheme, useSession, useTranslator } from '@luckystack/core/client';",
        replace: "import { SocketStatusIndicator } from '@luckystack/presence/client';\nimport { useTheme, useSession, useTranslator } from '@luckystack/core/client';",
      },
      {
        find: "import type { SessionLayout } from 'config';\n",
        replace: "import type { SessionLayout } from 'config';\nimport { useSocketStatus } from 'src/_providers/socketStatusProvider';\n",
      },
      {
        find: '  const { setTheme } = useTheme();\n',
        replace: '  const { setTheme } = useTheme();\n  const { socketStatus } = useSocketStatus();\n',
      },
      {
        find: '  const { socketStatus } = useSocketStatus();\n',
        replace: '  const { socketStatus } = useSocketStatus();\n  const translate = useTranslator();\n',
      },
      {
        find: '      <TemplateComponent>{children}</TemplateComponent>',
        replace:
          "      <SocketStatusIndicator\n" +
          '        status={socketStatus.self.status}\n' +
          '        reconnectAttempt={socketStatus.self.reconnectAttempt}\n' +
          "        label={translate({ key: 'template.socketStatus' })}\n" +
          '      />\n' +
          '      <TemplateComponent>{children}</TemplateComponent>',
      },
    ]);
  } catch (error) {
    return err(error as Error);
  }
  return ok();
};

export const addPresence = (project: ConsumerProject, options: AddOptions): Result<void> => {
  const mainPath = path.join(project.root, MAIN_TSX);
  const templateProviderPath = path.join(project.root, TEMPLATE_PROVIDER);

  if (!fs.existsSync(mainPath) || !fs.existsSync(templateProviderPath)) {
    return err(new Error(
      `Could not find ${MAIN_TSX} and ${TEMPLATE_PROVIDER} — is this a LuckyStack project with the default client layout?`,
    ));
  }

  //? Idempotency: if the LocationProvider mount is already wired, presence is
  //? already present (full scaffold, or a previous `add presence`). Skip the
  //? edits but still ensure the dependency + install ran.
  const mainAlreadyWired = fs.readFileSync(mainPath, 'utf8').includes('@luckystack/presence/client');

  if (mainAlreadyWired) {
    console.log('• presence client mounts already present — skipped JSX injection.');
  } else {
    //? main.tsx — reverse the pruner's three edits (PRUNED -> FULL).
    const edited = applyPresenceEdits(mainPath, templateProviderPath);
    if (!edited.ok) return edited;
    console.log('• injected <LocationProvider/> (main.tsx) + <SocketStatusIndicator/> (TemplateProvider.tsx)');
  }

  //? Add the dependency only AFTER the JSX edits succeed: a token-miss aborts above
  //? with package.json untouched, preserving the "command failed ⇒ nothing changed"
  //? invariant (otherwise package.json would be left mutated with no mounts injected).
  //? addDependency writes package.json and can throw on EACCES/EROFS — guard it into
  //? a returned Result, matching addBackendOnly.
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  let depAdded: boolean;
  try {
    depAdded = addDependency(project, '@luckystack/presence', range);
  } catch (error) {
    return err(error as Error);
  }
  if (depAdded) console.log(`• added @luckystack/presence@${range} to package.json`);

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root)) {
      console.warn('  npm install failed — run it manually to finish.');
    }
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }

  console.log('\n✓ presence added. Restart the dev server. Presence is gated by');
  console.log('  `socketActivityBroadcaster` / `socketStatusIndicator` in config.ts.');
  return ok();
};
