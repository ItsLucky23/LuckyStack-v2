/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
//? Argv parser MUST run before any module that reads `process.env.SERVER_PORT`
//? at load time (notably `../config.ts`'s top-level `backendUrl`).
//? Argv shape: npm run server -- <bundle[,bundle...]> [port]
import '@luckystack/server/parseArgv';

import { loadEnvFiles } from '@luckystack/core';

loadEnvFiles();

//? Side-effect imports — these must run before the framework boots so that
//? `getProjectConfig`, `getDeployConfig`, `getServicesConfig`, `getRuntimeMaps`,
//? and the localized error normalizer all resolve through the registries that
//? @luckystack/* packages read from. Order matters: config first, then deploy,
//? then services, then anything that calls into them.
import '../config';
import '../deploy.config';
import '../services.config';
import './utils/responseNormalizer';

import { initializeSentry } from '../functions/sentry';
import { registerSentryConfig } from '@luckystack/error-tracking';
import { registerPresenceHooks } from '@luckystack/presence';
import { bootstrapLuckyStack } from '@luckystack/server';
import {
  autoSelectEmailSender,
  registerEmailSender,
  registerEmailConfig,
} from '@luckystack/email';
import { serveFile, serveFavicon } from './prod/serveFile';
import { registerNotificationHooks } from './hooks/notifications';
import { registerWorkspacesTerminalHooks } from './hooks/workspacesTerminal';
import { resolveSecretsIfConfigured } from './bootstrap/initSecrets';
import projectConfig, { sentry as sentryConfigInput } from '../config';

//? @luckystack/email and @luckystack/error-tracking each own their config registry
//? (split out of core in 0.1.0). Register the slices from `config.ts` here on
//? the server side so the server-only adapters never get dragged into the
//? Vite client bundle.
//?
//? But first: resolve @luckystack/secret-manager pointers (NAME=BASE_V<n>) into
//? process.env. The email sender reads RESEND_API_KEY and Sentry reads SENTRY_DSN
//? just below; Prisma/Redis/JWT read theirs lazily at call time. A top-level await
//? is fine here (ESM entry, esbuild emits `format: esm`) and runs before these
//? registrations. No-op when the URL is unset or the package isn't installed —
//? boot then continues on the local env files.
await resolveSecretsIfConfigured(projectConfig.secretManager);

registerEmailConfig({
  from: projectConfig.email.from,
  required: projectConfig.email.required,
  logging: projectConfig.email.logging,
});
registerSentryConfig(sentryConfigInput);

initializeSentry();
registerPresenceHooks();
registerNotificationHooks();
registerWorkspacesTerminalHooks();

//? Resend → SMTP → Console fallback chain. The selector reads RESEND_API_KEY,
//? SMTP_HOST + friends from process.env. We pass `from` explicitly from the
//? project config so that consumers who only set RESEND_API_KEY (and not
//? EMAIL_FROM env) still get a working sender — config.ts defaults `from` to
//? `onboarding@resend.dev` (Resend's sandbox sender) which works with any
//? Resend account out of the box.
registerEmailSender(autoSelectEmailSender({ from: projectConfig.email.from }));

(async () => {
  //? Project-specific dev tooling. The package handles devkit + console.log init
  //? itself when enableDevTools is on; only the REPL is project-side.
  if (process.env.NODE_ENV !== 'production') {
    const { initRepl } = await import('./utils/repl');
    initRepl();
  }

  //? bootstrapLuckyStack auto-imports every file under `luckystack/<package>/`
  //? in topological order, then verifies every required registry is populated
  //? before listening. A consumer who skips the overlay folder can still call
  //? `createLuckyStackServer({...})` directly.
  //?
  //? `loadGeneratedMaps` is the only piece the framework can't do for us:
  //? dynamic-import resolution is module-scoped, so the relative path has to
  //? live in *this* file. The framework wires the rest of the
  //? RuntimeMapsProvider plumbing (dev/prod branching, devkit lookup,
  //? caching, registration) from a single callback.
  const server = await bootstrapLuckyStack({
    serveFile,
    serveFavicon,
    loadGeneratedMaps: (preset: string) => import(`./prod/generatedApis.${preset}`),
  });

  await server.listen();
})();
