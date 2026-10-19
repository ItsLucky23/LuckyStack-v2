---
name: router-forwards-the-visitor-ip-from-a-trusted-proxy-last-hop
title: The router forwards the visitor IP only from a trusted proxy's last hop
status: accepted
date: 2026-10-19
deciders: [ItsLucky23]
tags: [router, security, proxy, headers]
supersedes: []
relates: [0033]
---

## Context

ADR 0033 made `routing.trustedProxyCidrs` the trust boundary for
`x-forwarded-proto` and documents a TLS terminator (nginx, Caddy, a managed
ingress) in front of the router. The router still built `X-Forwarded-For` from
its own socket peer only. In that documented topology every visitor reached the
backend with the terminator's address: per-IP rate limits, login throttles and
IP bans became one shared bucket, and IP audit lost the visitor. The owner chose
to trust the last hop of a trusted proxy (sweep finding 054).

## Decision

When the immediate peer is inside `trustedProxyCidrs`, the router forwards the
last address of the inbound `X-Forwarded-For` chain — the address that trusted
proxy appended — as the single forwarded address, provided it parses as an IP;
otherwise it forwards the peer address. A peer outside `trustedProxyCidrs` keeps
the old behaviour: its socket address, inbound chain ignored. HTTP and WebSocket
forwarding share this rule, and earlier hops are never forwarded. This replaces
the sentence "Forwarded chains remain discarded" in ADR 0033 for a trusted peer
only.

## Rejected alternatives

- **Keep peer-only forwarding and document that per-IP limits behind a proxy
  count everyone as one visitor.** It leaves the documented topology broken.
- **A separate setting for which proxies may name the visitor.** A second list
  for the same proxies invites the two to drift apart; the proxy allowed to
  assert the scheme is the one that saw the visitor.
- **Forward the whole chain, or its leftmost hop.** The leftmost hops are
  written by the visitor and can be spoofed.
- **Append the proxy's address (`visitor, proxy`).** Backends on the default
  trusted hop count of one would read the proxy again.

## Consequences

- Same-host nginx/Caddy setups that list `127.0.0.1/32` get real visitor
  addresses without a backend change.
- Trust rests entirely on `trustedProxyCidrs`: listing a range that untrusted
  clients can connect from lets them choose their own IP, as it already lets
  them claim HTTPS.
- A trusted proxy that does not append `X-Forwarded-For` yields its own
  address.
