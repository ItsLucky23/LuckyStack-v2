//? Side-effect-only entrypoint. Import this as the FIRST line of your
//? `server.ts` so the positional CLI args (`<bundles> <port>`) are registered
//? before any other module evaluates the consumer config (notably its top-level
//? OAuth callback base).
//?
//? Usage:
//?   import '@luckystack/server/parseArgv';

import { applyServerArgv } from './argv';

applyServerArgv();
