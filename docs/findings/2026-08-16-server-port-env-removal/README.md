# `SERVER_PORT` removal assessment — 2026-08-16

> Exhaustive source scan of the remaining `SERVER_PORT` references after the
> scaffold callback-port fix. No runtime code was changed by this assessment.

Last updated: 2026-08-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---|---:|---|---|---|---|
| SPR-01 | `SERVER_PORT` is no longer a scaffold `.env` setting, but remains an internal argv→consumer-config bridge and a generic compatibility fallback | MED | open | 2026-08-16 | — | Removing it outright needs a replacement typed/config registry channel |
| SPR-02 | `config.ports.ts` already owns the scaffold's intended/default backend port; server bootstrap and Vite proxy do not need `SERVER_PORT` for the normal scaffold path | LOW | fixed | 2026-08-16 | 2026-08-16 | Existing `defaultPort: ports.backend` + `dev-server.json` path verified |
| SPR-03 | Auto-increment's actual bound port is separate from both env and `config.ports.ts` | MED | fixed | 2026-08-16 | 2026-08-16 | Must remain in the intended/bound core registry; it cannot be statically stored in `config.ports.ts` |
| SPR-04 | Generic consumers and programmatic `createLuckyStackServer({ port })` need a compatibility path unless a new intended-port registry is introduced | MED | open | 2026-08-16 | — | Existing `app.publicUrl`/`oauthCallbackBase` fallback and server API must not regress |

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

## Recommendation

Do **not** delete `SERVER_PORT` from the framework immediately. The public
scaffold contract can and should remain `config.ports.ts` + positional CLI
port; that is already the normal path. A future breaking cleanup can remove
`SERVER_PORT` only after replacing the argv writeback with a browser-safe,
core-owned intended-port registry (and deciding how programmatic `options.port`
becomes visible before OAuth provider construction). Keep the generic fallback
until that migration is complete.
