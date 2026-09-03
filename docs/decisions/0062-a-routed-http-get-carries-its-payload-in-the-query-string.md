---
name: a-routed-http-get-carries-its-payload-in-the-query-string
title: On routed-http a GET invocation keeps its declared method and carries its payload in the `__luckystack_data` query field
status: accepted
date: 2026-09-03
deciders: [mathijs]
tags: [http, transport, api, security, logging]
supersedes: []
relates: [0037]
---

## Context

`transport.invocation: 'routed-http'` (ADR 0037) sends typed `apiRequest`
invocations over HTTP instead of the socket. A route declares its HTTP method,
and the client honours it: a GET has no body, so its `data` object is
JSON-encoded into one reserved query field so nested objects, numbers and
booleans keep their types. Over the socket transport the same payload sat inside
a frame.

A consumer with 198 GET endpoints asked whether that was a conscious trade-off:
on routed-http those payloads now land in access logs, proxy logs, browser
history and the `Referer` header, and URL length limits apply where none did
before. Switching a project from `socket` to `routed-http` therefore silently
widens the logging surface of every GET route. `ARCHITECTURE_API.md` described
the mechanism; nothing described the consequence.

## Decision

Yes, deliberate: a route's declared method is preserved as-is, because that is
what makes routed-http an HTTP transport — caches, proxies, CDNs and HTTP
semantics behave as declared — and a GET's payload can only travel in the URL.
The consequence is now written down in `ARCHITECTURE_HTTP.md` next to the
routed-invocation model, with the guidance that follows from it: a GET route's
`data` is public to every log on the path, so anything sensitive belongs on a
route that declares `POST`, and a project switching transport should audit its
GET routes for exactly that.

## Rejected alternatives

- **Tunnel every routed invocation as POST** — rejected because it discards the
  declared method for every route to protect the minority that should not have
  been GET; it also breaks HTTP caching for the read routes that are the reason
  GET exists.
- **A config knob (`query` vs `body` for GET payloads) or an automatic switch
  to POST above a URL length** — rejected for now as new config surface for a
  problem no consumer has asked to solve in code; a route author already has
  the lever (`httpMethod`). Revisit when a consumer needs it, not before.
- **Strip or hash the payload in logs** — not the framework's to do; the logs
  belong to the proxies and browsers on the path.

## Consequences

- No code change. The audit burden moves to the transport switch, where the
  doc now puts it.
- The socket transport keeps its narrower surface; a project that needs GET
  payloads out of URLs and cannot change the routes stays on `socket`.
