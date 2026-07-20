import fs from 'node:fs';
import path from 'node:path';

//? Resolve the base URL the test sweep should target.
//?
//? Priority:
//?   1. explicit `TEST_BASE_URL` — an operator override always wins.
//?   2. the dev server's ACTUALLY-bound port from
//?      `node_modules/.luckystack/dev-server.json` (written by the server after
//?      any `SERVER_PORT_AUTO_INCREMENT` hop off a busy port).
//?   3. the historical `http://localhost:80` default.
//?
//? Without step 2, a hopped dev server (`:80` busy → `:81`) made every test layer
//? hammer `:80` and report the resulting connection failures as TEST failures —
//? the sweep blamed the code for a stale-port mismatch. This mirrors how the
//? template Vite proxy already follows the same file.
export const resolveTestBaseUrl = (): string => {
  const explicit = process.env.TEST_BASE_URL;
  if (explicit) return explicit;

  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'),
      'utf8',
    );
    const info = JSON.parse(raw) as { port?: number };
    if (typeof info.port === 'number') return `http://localhost:${String(info.port)}`;
  } catch {
    //? No file (server not up, or a production run) — fall through to the default.
  }

  return 'http://localhost:80';
};
