---
name: routed-http-method-resolution-fails-closed
title: Routed HTTP method resolution fails closed
status: accepted
date: 2026-07-28
deciders: [mathijs]
tags: [api, routed-http, method-map, security]
relates: [0037, 0043]
---

## Context

A routed API request must choose an HTTP method before it reaches the router. Route-name inference cannot distinguish explicit contracts such as `organization → GET` and `getOrganization → POST`. Falling back to a guessed method when the generated map is missing can execute the wrong transport semantics or produce a misleading downstream `405`.

Socket invocation does not need an HTTP method. Its legacy name heuristic is used only for conservative abort-controller behavior and remains useful for older wrappers.

## Decision

Routed HTTP API invocation requires a successful generated `apiMethodMap` lookup. A missing registration, route or version settles locally with `api.methodMapUnavailable` and sends no network request. Socket mode retains its existing compatibility heuristic.

## Rejected alternatives

- **Keep inferring in every transport.** This silently violates explicit handler methods and recreated the regression the method map was introduced to prevent.
- **Default every unknown routed request to POST.** This is still a guess and breaks explicit GET/PUT/DELETE contracts.
- **Remove all inference, including socket abort selection.** Socket transport does not need method routing, and removing the conservative compatibility behavior would create unnecessary churn for older consumers.

## Consequences

- Router-enabled consumers must register their generated method map during browser bootstrap.
- Missing or stale generated wiring fails early with a specific error instead of becoming an ambiguous `405`.
- Existing socket-first consumers keep their historical behavior.
