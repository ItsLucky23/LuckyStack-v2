//? Side-effect-only entrypoint. Import this as the FIRST line of your
//? `server.ts` so the positional CLI args (`<bundles> <port>`) are parsed
//? and written into `process.env.SERVER_PORT` before any other module load
//? reads it (notably `config.ts` which builds `backendUrl` at top level).
//?
//? Usage:
//?   import '@luckystack/server/parseArgv';

import { applyServerArgv } from './argv';

applyServerArgv();
