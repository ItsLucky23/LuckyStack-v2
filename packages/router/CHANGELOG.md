# Changelog

All notable changes to `@luckystack/router` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The router now refuses to start on a runtime that cannot deliver a WebSocket
  upgrade**, instead of serving HTTP and reporting healthy while silently dropping
  every socket.

  This is Bun today. Bun's `node:http` does not implement upgrade sockets:
  `server.on('upgrade')` fires, the socket reports `writable === true`,
  `socket.write()` returns `true` and its callback reports no error — and nothing
  reaches the client. `http.request()` with an `Upgrade` header hangs without
  emitting `'upgrade'` or `'response'`. Upstream:
  [oven-sh/bun#28396](https://github.com/oven-sh/bun/issues/28396), open, affecting
  every WebSocket proxy in the Node ecosystem. **Run the router on Node.** The rest
  of LuckyStack — including a backend serving WebSockets — runs on Bun fine; this
  is specific to proxying them.

  It is a **capability probe, not a runtime check**: at boot the router measures
  whether an upgrade handshake actually reaches a client (one loopback connection,
  ~14ms, skipped entirely on Node). When Bun ships the fix, the router simply
  starts — no release of ours needed. Set `LUCKYSTACK_ALLOW_BROKEN_WS_PROXY=1` to
  downgrade the refusal to a warning if your deployment never upgrades.

### Fixed

- **The router never shut down while a client was connected.** `stop()` was a bare
  `server.close()`, which waits for every open connection to end by itself — and an
  upgraded WebSocket pipe never does. For a router whose whole job includes proxying
  sockets, that meant `stop()` simply never resolved. `luckystack-router` awaits it
  before exiting on SIGTERM, so shutdown hung until the platform's grace period ran
  out and SIGKILLed the process (30s on a default Kubernetes pod), severing in-flight
  work instead of draining it.

  `stop()` now stops accepting connections, drops idle keep-alives immediately, lets
  in-flight HTTP requests finish for up to 10s, then force-closes what remains.
  Measured: 10s with a live WebSocket client (was: never), **0ms with none**.

  Note for anyone tempted to simplify this to `server.closeAllConnections()`: that
  call does **not** touch sockets handed to an `'upgrade'` listener — with one
  upgraded client, `getConnections()` stays at 1 and the close callback never fires.
  The upgraded sockets must be tracked and destroyed explicitly.

- **No WebSocket could cross the router. At all.** Forwarding the upstream
  `101 Switching Protocols` back to the client stripped `Connection: Upgrade` —
  the response-side header filter reused the request-side hop-by-hop set, which
  correctly drops `connection` on a request but must not on a 101, where RFC 6455
  §4.2.2 requires it. The client saw a 101 with `Upgrade: websocket` and no
  `Connection`, which is not a completable handshake: Node's parser refuses to
  emit `'upgrade'` and socket.io/ws fail with a bare "websocket error". Since
  WebSocket upgrades pin to the `system` service, this disabled the package's
  whole purpose in a multi-instance deploy.

  Introduced in 0.4.0 by a security sweep whose intent was sound (a backend must
  not inject `Set-Cookie` or internal `x-luckystack-*` markers into the browser
  through the upgrade response) — that intent is preserved and now has its own
  test. Working versions: 0.1.x–0.3.x. **Broken: 0.4.0 through 0.6.7.**

  Missed for three weeks because the test asserted only that the response status
  line contained "101" — true the whole time, and useless. The regression tests
  now read the full header block.

- **A default socket.io client could not connect through the router.** socket.io
  opens with an XHR polling handshake on `/socket.io/?EIO=4&transport=polling`
  before it can upgrade, and the HTTP proxy resolved that path's first segment as
  a service key — looking for a service literally named `socket.io`, finding no
  binding, and answering `502 serviceNotAssigned`. Since the framework's client
  sets no `transports`, every browser took exactly this path and never reached the
  upgrade.

  The polling handshake now pins to the same service as the upgrade
  (`routing.websocketService`, default `system`), mirroring what the WebSocket
  proxy has always done. Normal `/api/<service>/…` routing is unchanged.

- **The router refused to start on a standard HTTPS deployment.** Every binding
  must declare an explicit port — but the check tested `new URL(target).port`,
  which is EMPTY for a protocol's DEFAULT port. So `https://api.example.com:443/x`
  looked identical to the port-less `https://api.example.com/x`, and an operator
  who wrote `:443` was told their port was "missing", with no way to comply short
  of picking a non-default port. Present since 0.2.0.

  `:443` and `:80` are now accepted; a genuinely port-less binding is still
  rejected, because relying on 80/443 by omission is how a multi-instance topology
  silently collapses onto one target. The check reads the raw URL text, so IPv6
  literals (`http://[::1]:4100`) and userinfo containing `@` are handled correctly.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
