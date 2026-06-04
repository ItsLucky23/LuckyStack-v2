//? Boot a SECOND backend instance on a custom port, sharing the same `.env`
//? Redis/Mongo — for the local multi-instance smoke test described in
//? docs/ARCHITECTURE_MULTI_INSTANCE.md. Bypasses the dev supervisor (no
//? hot-reload) and boots `server/server.ts` directly.
//?
//?   Usage:  npm run cluster -- <port>        e.g.  npm run cluster -- 4101
//?
//? The port is injected through the server's own argv parser
//? (`@luckystack/server/parseArgv`, shape `<bundles> [port]`) so `getParsedPort()`
//? wins over any `SERVER_PORT` in `.env` / `.env.local`. `core-preset` is a no-op
//? in dev (NODE_ENV !== 'production' loads every route via devkit) — it only
//? satisfies the required first positional so the port lands in slot two.

const port = process.argv[2];

if (!port || !/^\d+$/.test(port)) {
  console.error('Usage: npm run cluster -- <port>   (example: npm run cluster -- 4101)');
  process.exit(1);
}

//? Reshape argv into `<bundles> <port>` BEFORE importing server.ts (its first
//? line imports the argv parser, which reads process.argv at module load).
process.argv = [process.argv[0] as string, process.argv[1] as string, 'core-preset', port];

await import('../server/server');
