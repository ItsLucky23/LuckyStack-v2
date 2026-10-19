---
name: test-runner-api-probes-follow-the-project-transport
title: Test-runner API probes follow the project transport, like sync probes
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [test-runner, api, testing, transport]
supersedes: []
relates: [0064]
---

## Context

ADR 0064 made sync probes and `ctx.callSync` follow `transport.invocation`, but
API probes and `ctx.callApi` kept using the `/api/*` HTTP route. In the default
socket mode the real client sends API calls over Socket.io, whose pipeline has
its own auth extraction, rate-limit keying and error envelope. So the rule
"never test a route over a different path than real clients use" was broken for
every API route.

## Decision

This extends ADR 0064 to API routes. API probes in the contract, auth,
rate-limit and fuzz layers, and `ctx.callApi`, use the transport resolved from
`transport.invocation`: the socket API event for `'socket'` projects, `/api/*`
for `'routed-http'` projects. A run-wide option and a per-call option override
it. The CSRF layer stays on HTTP, because CSRF is an HTTP-only guard. Socket
replies expose the envelope's HTTP status, so status checks behave the same on
both transports.

## Rejected alternatives

- **Keep API probes on HTTP and document the gap.** Already rejected for sync
  in ADR 0064: it leaves the default transport untested.
- **Probe every API route over both transports.** It doubles traffic and
  rate-limit pressure, and still does not say which path clients use.

## Consequences

- Sweep results in socket-mode projects can change where the two pipelines
  differ. That is the intended signal.
- A project can opt back into HTTP for a whole run or for one call.
