//? @adr 0031
//? Server bind-address registry. The `createLuckyStackServer` bootstrap
//? populates this with the actual listen `ip`/`port` so framework code that
//? needs the bind address (e.g. `checkOrigin` building the same-origin
//? entry) doesn't drift when the consumer used the `options.ip`/`options.port`
//? arguments instead.
//?
//? `registerBindAddress` stores the intended address before `listen`;
//? `registerBoundAddress` then records the address reported by node:http. Keeping
//? both values lets readers see reality while OAuth rewrites only a stale direct
//? callback that still names the intended pre-hop port — never an explicit local
//? router/reverse-proxy ingress.
//?
//? Resolution at call time:
//?   1. registered current value (intended before listen, bound after success)
//?   2. `process.env.SERVER_IP` for the bind address
//?   3. `'127.0.0.1'` / port `'80'` as the generic pre-bootstrap fallback

import { isProductionRuntime } from './env';

interface BindAddress {
  ip: string;
  port: number;
}

interface IntendedBindAddress extends BindAddress {
  configuredPort?: number;
}

const DEFAULT_SERVER_PORT = '80';

let intended: BindAddress | null = null;
let configuredPort: number | null = null;
let registered: BindAddress | null = null;

export const registerBindAddress = (address: IntendedBindAddress): void => {
  intended = { ip: address.ip, port: address.port };
  configuredPort = address.configuredPort ?? null;
  registered = intended;
};

export const registerBoundAddress = (address: BindAddress): void => {
  intended ??= address;
  registered = address;
};

export const getBindAddress = (): { ip: string; port: string } => {
  if (registered) {
    return { ip: registered.ip, port: String(registered.port) };
  }
  return {
    ip: process.env.SERVER_IP ?? '127.0.0.1',
    //? A real server registers its intended/defaultPort before OAuth or CORS
    //? reads this value. Port 80 only remains the generic pre-bootstrap fallback.
    port: DEFAULT_SERVER_PORT,
  };
};

const defaultPortForProtocol = (protocol: string): string => (protocol === 'https:' ? '443' : '80');

//? Make an OAuth callback URL reflect the port the server ACTUALLY bound.
//?
//? In dev the backend may auto-increment off its intended port (`:80` busy →
//? `:81`), but `oauthCallbackBase` is frozen at the intended port the moment
//? `config.ts` runs at module load. A frozen `redirect_uri` then points the OAuth
//? round-trip at a dead port. This rewrites ONLY a loopback callback that still
//? names the intended pre-listen port. An explicit localhost router/reverse proxy
//? on another port remains authoritative. `localhost`, `127.0.0.1`, and IPv6
//? `[::1]` use the same loopback policy as CORS.
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
  if (isProductionRuntime()) return callbackUrl;

  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return callbackUrl;
  }

  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return callbackUrl;

  const boundPort = getBindAddress().port;
  const intendedPort = intended ? String(intended.port) : '';
  if (!boundPort || !intendedPort) return callbackUrl;

  const currentPort = url.port || defaultPortForProtocol(url.protocol);
  const matchesIntendedPort = currentPort === intendedPort;
  const matchesConfiguredPort = configuredPort !== null && currentPort === String(configuredPort);
  if (currentPort === boundPort || (!matchesIntendedPort && !matchesConfiguredPort)) return callbackUrl;

  url.port = boundPort === defaultPortForProtocol(url.protocol) ? '' : boundPort;
  return url.toString();
};
