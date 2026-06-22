import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@luckystack/core';

//? Dev-only handshake between the two local processes (`npm run server` and
//? `npm run client`). When the backend auto-increments off a busy `SERVER_PORT`
//? (see `listenLuckyStackServer`), the Vite proxy — which only knows the `.env`
//? `SERVER_PORT` — would keep targeting the OLD port and every proxied request
//? (api / sync / the socket.io websocket) would miss. So the backend advertises
//? its ACTUAL bound port here and the template `vite.config.ts` reads it.
//?
//? Location: `node_modules/.luckystack/` — always gitignored (no `.gitignore`
//? edit, no repo clutter) and present at the shared project cwd for both
//? processes. Purely ephemeral: rewritten on every dev boot, removed on exit;
//? a stale file is harmless (the proxy falls back to `SERVER_PORT`).
const DEV_SERVER_FILE = ['node_modules', '.luckystack', 'dev-server.json'] as const;

const devServerInfoPath = (): string => path.join(process.cwd(), ...DEV_SERVER_FILE);

export interface DevServerInfo {
  ip: string;
  port: number;
  pid: number;
}

//? Best-effort: a failed write must NEVER take the server down. Worst case the
//? proxy falls back to `.env` `SERVER_PORT` (the pre-existing behaviour).
export const writeDevServerInfo = (ip: string, port: number): void => {
  try {
    const file = devServerInfoPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const info: DevServerInfo = { ip, port, pid: process.pid };
    fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`);
  } catch (error) {
    getLogger().debug(
      `[dev-server-info] could not write port file (proxy will fall back to SERVER_PORT): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

//? Remove the file on a clean exit so a later `npm run client` started without a
//? backend doesn't proxy to a dead port. Silently ignores a missing file.
export const clearDevServerInfo = (): void => {
  try {
    fs.rmSync(devServerInfoPath(), { force: true });
  } catch {
    //? Ignore — a leftover file is rewritten on the next dev boot, and the proxy
    //? falls back to SERVER_PORT when it points at a port nothing answers on.
  }
};
