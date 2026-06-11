//? Side-effect `./register` entry for @luckystack/docs-ui. Auto-imported at boot
//? by @luckystack/server's `bootstrapLuckyStack` (BEFORE `createLuckyStackServer`
//? reads the custom-route registry) when this package is installed, so the dev
//? API docs page mounts at `/_docs` with NO consumer code edit — `npm i
//? @luckystack/docs-ui` + restart is enough.
//?
//? `mountDocsUi()` auto-disables in production (returns 404) unless mounted with
//? `{ enabledInProd: true }`. Consumers who want custom branding / routePath can
//? still mount their own via a `luckystack/docs-ui/index.ts` overlay.
//?
//? This file statically imports `@luckystack/server` for `registerCustomRoute`,
//? so @luckystack/docs-ui builds AFTER @luckystack/server in `buildPackages.mjs`.
//? At runtime the importer IS @luckystack/server, so the dependency is always
//? satisfied.

import { registerCustomRoute } from '@luckystack/server';
import { mountDocsUi } from './index';

registerCustomRoute(mountDocsUi());
