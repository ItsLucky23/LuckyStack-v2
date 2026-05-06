//? Dev-only API docs UI. Registers a `customRoutes` handler at `/_docs`.
//? Side-effect import: `bootstrapLuckyStack` auto-loads this file before
//? `createLuckyStackServer` consults the custom-routes registry.

import { mountDocsUi } from '@luckystack/docs-ui';
import { registerCustomRoute } from '@luckystack/server';

registerCustomRoute(mountDocsUi({
  // routePath: '/_docs',
  // pageTitle: 'My App — API docs',
  // enabledInProd: false,
}));
