# `SERVER_PORT` removal assessment — 2026-08-16

> Exhaustive source scan and completed migration of the remaining legacy
> backend-port environment bridge.

Last updated: 2026-08-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---|---:|---|---|---|---|
| SPR-01 | `SERVER_PORT` is no longer a scaffold `.env` setting, but remains an internal argv→consumer-config bridge and a generic compatibility fallback | MED | fixed | 2026-08-16 | 2026-08-16 | Replaced by `@luckystack/core/config` `registerPortOverride` / `getPortOverride`; generic numeric fallback stays 80 |
| SPR-02 | `config.ports.ts` already owns the scaffold's intended/default backend port; server bootstrap and Vite proxy do not need `SERVER_PORT` for the normal scaffold path | LOW | fixed | 2026-08-16 | 2026-08-16 | Existing `defaultPort: ports.backend` + `dev-server.json` path verified |
| SPR-03 | Auto-increment's actual bound port is separate from both env and `config.ports.ts` | MED | fixed | 2026-08-16 | 2026-08-16 | Must remain in the intended/bound core registry; it cannot be statically stored in `config.ports.ts` |
| SPR-04 | Generic consumers and programmatic `createLuckyStackServer({ port })` need a compatibility path unless a new intended-port registry is introduced | MED | fixed | 2026-08-16 | 2026-08-16 | Generic consumers retain explicit callback/public URL + numeric port fallback; configured-default metadata preserves programmatic OAuth parity |

## Assessment

The remaining runtime uses are concentrated in:

- `packages/server/src/argv.ts`: writes an explicit positional CLI port so the
  consumer `config.ts` can see it before OAuth provider registration.
- `config.ts` and the scaffold `template/config.ts`: read the explicit override
  before falling back to `config.ports.ts`.
- `packages/server/src/createServer.ts` and `portResolution.ts`: legacy fallback
  below `defaultPort`.
- `packages/core/src/bindAddress.ts`: generic pre-bootstrap fallback.
- CLI diagnostics, tests, and documentation.

`SERVER_PORT_AUTO_INCREMENT` is a separate policy flag and is not part of this
removal question.

## Resolution

The compatibility cleanup is complete under ADR 0039. Positional argv now uses
the browser-safe core/config registry; the server no longer reads a backend
listen port from the environment; and bind registration carries enough
configured-default metadata to preserve programmatic OAuth behavior without
bypassing an explicit router ingress. Migrate legacy deployments to
`config.ports.ts`, positional argv, or `createLuckyStackServer` options.
