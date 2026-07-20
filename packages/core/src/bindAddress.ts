//? Server bind-address registry. The `createLuckyStackServer` bootstrap
//? populates this with the actual listen `ip`/`port` so framework code that
//? needs the bind address (e.g. `checkOrigin` building the same-origin
//? entry) doesn't drift from `SERVER_IP`/`SERVER_PORT` env vars when the
//? consumer used the `options.ip`/`options.port` arguments instead.
//?
//? It is registered TWICE: once with the intended port before `listen`, and
//? again inside the listen callback with the port actually bound — so a dev
//? auto-increment hop (see `listenLuckyStackServer`) does not leave every
//? `getBindAddress()` reader pointing at a port nothing answers on.
//?
//? Resolution at call time:
//?   1. `registerBindAddress(...)` value (if the server has booted)
//?   2. `process.env.SERVER_IP` / `process.env.SERVER_PORT` (legacy)
//?   3. `'127.0.0.1'` / `''` as the absolute fallback

import { resolveEnvKey } from './bootUuid';

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

const defaultPortForProtocol = (protocol: string): string => (protocol === 'https:' ? '443' : '80');

//? Make an OAuth callback URL reflect the port the server ACTUALLY bound.
//?
//? In dev the backend may auto-increment off its intended port (`:80` busy →
//? `:81`), but `oauthCallbackBase` is frozen at the intended port the moment
//? `config.ts` runs at module load. A frozen `redirect_uri` then points the OAuth
//? round-trip at a dead port. This rewrites ONLY the port of a `localhost` /
//? `127.0.0.1` callback URL to the truthful bound port (`getBindAddress()`, which
//? the server re-registers post-`listen`), so OAuth always targets the live
//? server.
//?
//? SAFETY — authorize and token-exchange must send a BYTE-IDENTICAL `redirect_uri`
//? (OAuth requires it). Both derive from this helper, and `getBindAddress()` is
//? constant for the process lifetime, so the two calls agree. It is NOT
//? request-derived (never attacker-influenced), so it needs no per-state storage.
//?
//? Prod is a no-op: no hop, and the public callback domain has no localhost port
//? to chase. A non-localhost base (remote dev backend) is returned untouched.
//? Default ports collapse to the empty string so the emitted URL stays
//? byte-stable with how a provider redirect_uri is normally registered
//? (`http://localhost/...`, not `http://localhost:80/...`).
export const resolveDevCallbackUrl = (callbackUrl: string): string => {
  if (resolveEnvKey() === 'production') return callbackUrl;

  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return callbackUrl;
  }

  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return callbackUrl;

  const boundPort = getBindAddress().port;
  if (!boundPort) return callbackUrl;

  const currentPort = url.port || defaultPortForProtocol(url.protocol);
  if (currentPort === boundPort) return callbackUrl;

  url.port = boundPort === defaultPortForProtocol(url.protocol) ? '' : boundPort;
  return url.toString();
};
