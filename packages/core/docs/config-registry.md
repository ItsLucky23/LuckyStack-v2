# Config registry

The project, deployment and services registries decouple reusable framework packages from consumer files. Register during boot, read at call time; avoid capturing a configuration snapshot at import time. Explicit registration checks allow security-critical boot paths to reject missing setup rather than silently using permissive assumptions. See `../src/projectConfig.ts`, `../src/deployConfigRegistry.ts`, `../src/servicesConfigRegistry.ts` and `../../server/src/verifyBootstrap.ts`.

Cookie versus bearer session mode is a security choice, not a formatting choice. Switching modes affects CSRF, token extraction and persistence; audit those boundaries before changing it (`../src/extractToken.ts`, `../../server/src/httpRoutes/csrfMiddleware.ts`). Types and defaults belong to `../src/projectConfig.ts`, never a second hand-maintained table here.
