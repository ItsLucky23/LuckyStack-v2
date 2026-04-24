/**
 * LuckyStack load-balancer entrypoint.
 *
 * Usage:
 *   npm run router
 *   ROUTER_PORT=4000 NODE_ENV=development npm run router
 *   ROUTER_PORT=4000 LUCKYSTACK_ENV=staging LUCKYSTACK_PRESET=fleet-preset npm run router
 *
 * Environment:
 *   - ROUTER_PORT         Port to listen on (default 4000).
 *   - LUCKYSTACK_ENV      Which `deploy.config.ts -> environments` key this
 *                         router represents. Falls back to NODE_ENV, then
 *                         'development'.
 *   - LUCKYSTACK_PRESET   Preset key that the locally-running backend bundle
 *                         contains (optional — bounds which services count as
 *                         "local"; others go straight to fallback env).
 */

import { startRouter } from '../packages/router/src/startRouter';

const currentEnvKey =
  process.env.LUCKYSTACK_ENV
  ?? process.env.NODE_ENV
  ?? 'development';

const localPresetKey = process.env.LUCKYSTACK_PRESET;

await startRouter({
  currentEnvKey,
  localPresetKey: localPresetKey && localPresetKey.length > 0 ? localPresetKey : undefined,
});
