//? Server bind-address registry. The `createLuckyStackServer` bootstrap
//? populates this with the actual listen `ip`/`port` so framework code that
//? needs the bind address (e.g. `checkOrigin` building the same-origin
//? entry) doesn't drift from `SERVER_IP`/`SERVER_PORT` env vars when the
//? consumer used the `options.ip`/`options.port` arguments instead.
//?
//? Resolution at call time:
//?   1. `registerBindAddress(...)` value (if the server has booted)
//?   2. `process.env.SERVER_IP` / `process.env.SERVER_PORT` (legacy)
//?   3. `'127.0.0.1'` / `''` as the absolute fallback

interface BindAddress {
  ip: string;
  port: number;
}

let registered: BindAddress | null = null;

export const registerBindAddress = (address: BindAddress): void => {
  registered = address;
};

export const getBindAddress = (): { ip: string; port: string } => {
  if (registered) {
    return { ip: registered.ip, port: String(registered.port) };
  }
  return {
    ip: process.env.SERVER_IP ?? '127.0.0.1',
    port: process.env.SERVER_PORT ?? '',
  };
};
