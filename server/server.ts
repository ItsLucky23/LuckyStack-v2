/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

//? Side-effect imports — these must run before the framework boots so that
//? `getProjectConfig`, `getDeployConfig`, `getServicesConfig`, `getRuntimeMaps`,
//? and the localized error normalizer all resolve through the registries that
//? @luckystack/* packages read from. Order matters: config first, then deploy,
//? then services, then anything that calls into them.
import '../config';
import '../deploy.config';
import '../services.config';
import './utils/responseNormalizer';
import './prod/runtimeMaps';

import { initializeSentry } from './functions/sentry';
import { registerPresenceHooks } from '@luckystack/presence';
import { bootstrapLuckyStack } from '@luckystack/server';
import { autoSelectEmailSender, registerEmailSender } from '@luckystack/email';
import { serveFile, serveFavicon } from './prod/serveFile';
import { registerNotificationHooks } from './hooks/notifications';

initializeSentry();
registerPresenceHooks();
registerNotificationHooks();

//? Resend → SMTP → Console fallback chain. The selector reads RESEND_API_KEY,
//? SMTP_HOST + friends, and EMAIL_FROM directly from process.env. Every
//? project used to inline this logic; the package now ships it.
registerEmailSender(autoSelectEmailSender());

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
  const server = await bootstrapLuckyStack({
    serveFile,
    serveFavicon,
  });

  await server.listen();
})();
