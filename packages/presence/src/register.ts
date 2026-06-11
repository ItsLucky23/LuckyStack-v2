//? Side-effect `./register` entry for @luckystack/presence. Auto-imported at
//? boot by @luckystack/server's `bootstrapLuckyStack` when this package is
//? installed, so presence wires itself with NO consumer code edit — `npm i
//? @luckystack/presence` + restart is enough (peer notifications still gated by
//? `projectConfig.socketActivityBroadcaster`).
//?
//? Registers the `postLogout` cleanup + activity-broadcaster hooks
//? (`registerPresenceHooks`, idempotent via its own module guard).
//?
//? A consumer overlay (`luckystack/presence/*.ts`) runs AFTER this import and
//? can register alternative activity events / presence config.

import { registerPresenceHooks } from './hooks';

registerPresenceHooks();
