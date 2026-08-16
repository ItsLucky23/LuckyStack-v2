# OAuth scaffold-port contract review — 2026-08-16

> Findings ledger for the handoff review of OAuth callback ports versus the
> consumer-owned `config.ports.ts`. The fix is intentionally framework-only;
> `@luckystack/router` remains optional.

Last updated: 2026-08-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---|---:|---|---|---|---|
| OSP-01 | Core copied its implicit `SERVER_PORT=80` schema default into `process.env`, hiding a scaffold's `ports.backend` from `config.ts` | HIGH | fixed | 2026-08-16 | 2026-08-16 | `packages/core/src/env.ts`; explicit env and argv writeback remain supported |
| OSP-02 | Scaffold OAuth/config comments and provider setup examples described port 80 instead of the consumer-owned backend port | MED | fixed | 2026-08-16 | 2026-08-16 | Template, auth docs, package docs, README, and env templates updated |
| OSP-03 | Regression coverage did not pin non-default scaffold ports across config, listen, and OAuth rewrite paths | HIGH | fixed | 2026-08-16 | 2026-08-16 | Added 4787 default, CLI override, 4787→4788 hop, production, and parity tests |
| OSP-04 | Generic consumers without `config.ports.ts` need the existing `oauthCallbackBase`/`app.publicUrl` fallback | MED | fixed | 2026-08-16 | 2026-08-16 | `packages/login/src/register.test.ts` pins the fallback |

## Resolution

The validated core snapshot still exposes `SERVER_PORT='80'`, and the server
still has a generic final fallback of 80. The implicit value is no longer
written to `process.env`; only an explicit env value or positional CLI port is
written there. The scaffold therefore uses `ports.backend` for both
`defaultPort` and `oauthCallbackBase`, while the existing intended/bound
registry handles a later auto-increment hop.

See ADR 0038 for the durable contract decision.
