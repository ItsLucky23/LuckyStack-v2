# presence — Verified & Merged Audit Findings
Sources: reports/presence.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
17 distinct findings merged across the two scans (the `reports/` deep audit + the five `review/v0.2.0/` dimension files). Verified against current code: **9 CONFIRMED**, **2 PARTIALLY-FIXED**, **5 REFUTED/already-correct-by-design**, **1 UNCERTAIN**. No critical or high-severity *security* hole survives: presence resolves `userId` server-side from the session for every broadcast, so cross-user identity spoofing is genuinely not possible (both scans agree, correctly). The biggest *live* issues are: (1) **QUA-039** — `socketConnected` fires `userBack` to roommates even when `socketActivityBroadcaster` is OFF (the loadSocket call-site at `:134` is gated only on `capabilities.presence`, not on the broadcaster flag), contradicting the package's own documented contract; (2) **SEC-07** — the disconnect-grace timer deletes a shared session out from under a still-connected second tab (no live-socket check); (3) the **doc-drift cluster** (QUA-041) — shipped docs still describe a token-leaking `io.to(room).emit({ token })` AFK broadcast and a `recipientCount: -1` sentinel that no longer exist in code. The single most important thing the older scans got partly wrong: `reports/` M1 and `review/` SEC-28 both quote `lifecycle.ts:27`/`:33` as leaking the raw token, which is still literally true at debug-level — but the AFK broadcast token-leak they reference historically is already fixed in `afkEvent.ts` (now `{ userId, endTime }`), and only the docs still describe the old leak.

## Findings

### QUA-039 — `userBack` broadcast not gated by `socketActivityBroadcaster`; fires on configs that disabled it  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(QUA-039)
- **Current location:** `packages/server/src/loadSocket.ts:134-139` (caller); `packages/presence/src/activity/lifecycle.ts:55-58` (broadcast); contract `packages/presence/docs/lifecycle.md:89`, `:99`
- **Original claim:** Two violations: (1) `informRoomPeers(userBack)` runs whenever the session has roomCodes+userId regardless of `isReconnect`, contradicting lifecycle.md:99 "cold connect = no userBack broadcast"; (2) the loadSocket caller invokes `socketConnected` WITHOUT checking `activityBroadcasterEnabled`, while register.ts / CLAUDE.md / lifecycle.md:89 promise peer notifications are gated by `socketActivityBroadcaster` (default false).
- **Verification (current code):** Confirmed both. `loadSocket.ts:123` computes `const activityBroadcasterEnabled = config.socketActivityBroadcaster ?? false;` but the presence call at `:134` is gated only on `token && capabilities.presence` — `activityBroadcasterEnabled` is never consulted before `presence.socketConnected({ token, io })`. Inside `lifecycle.ts`, `socketConnected` calls `informRoomPeers({ ... event: userBack ... })` at `:58` unconditionally once `roomCodes.length > 0 && userId` — there is no `isReconnect` guard on the broadcast (the `isReconnect` flag only gates the `postSocketReconnect` hook at `:47-53`). So a cold connect with persisted roomCodes broadcasts `userBack`, and it does so even when the consumer left `socketActivityBroadcaster` at its default `false`.
- **Verdict & why:** CONFIRMED. Merely installing `@luckystack/presence` makes every connect with persisted `roomCodes` fan out `userBack` to roommates regardless of the gate flag — a privacy/traffic behavior the consumer explicitly left disabled, and it diverges from the docs they'd debug against.
- **Recommendation:** Gate the call site (`if (token && capabilities.presence && activityBroadcasterEnabled)`) or read `getProjectConfig().socketActivityBroadcaster` inside `socketConnected` before `informRoomPeers`. Decide whether cold-connect `userBack` is intended and align `lifecycle.ts` + `lifecycle.md:99` either way. Add a regression test: broadcaster off → `informRoomPeers` not called.

### SEC-07 — Grace-expiry teardown deletes a shared session while another tab's socket is still live  ·  severity: high  ·  status: CONFIRMED
- **Sources:** review(SEC-07)
- **Current location:** `packages/presence/src/activity/lifecycle.ts:95-109`; related `packages/server/src/loadSocket.ts` (token room join `await socket.join(token)`)
- **Original claim:** The disconnect grace timer is keyed by session token; its expiry body unconditionally runs `socketLeaveRoom` then `removeSession(token)`. Two tabs share one token but hold two sockets; closing tab B arms the timer, tab A stays connected so `socketConnected` never re-fires to cancel it, and after `transportCloseMs` (60s) the shared session is deleted under still-active tab A.
- **Verification (current code):** Confirmed. The `setTimeout` body (`:95-109`) checks `tempDisconnectedSockets.has(token)` (`:96`) and `disconnectTimers.get(token) !== timeout` (`:100`) — both are token-keyed grace bookkeeping, NOT a check for remaining live sockets on the token. It then runs `await socketLeaveRoom(...)` (`:102`) and, if `deleteSessionOnDisconnect`, `await removeSession(token)` (`:105`). Nothing consults `io.sockets.adapter.rooms.get(token)?.size`. Since every socket joins its private token room, the data for the check exists but is unused. Only reachable when presence is active, which (per QUA-039) is broader than intended.
- **Verdict & why:** CONFIRMED. A normal multi-tab user is logged out of all tabs ~60s after closing one — a reliability bug that also weakens the session model by deleting live sessions. `reports/` did not raise this multi-tab angle; `review/` is right.
- **Recommendation:** In the timeout callback, bail when the token still has live sockets: `const live = getIoInstance()?.sockets.adapter.rooms.get(token)?.size ?? 0; if (live > 0) return;` before `socketLeaveRoom`/`removeSession`. Add a two-socket lifecycle test.

### M1 / SEC-28 — Raw session token written to presence logs, bypassing core's redaction set  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(M1) + review(SEC-28) — both
- **Current location:** `packages/presence/src/activity/lifecycle.ts:27`, `:33` (debug); `packages/presence/src/activity/leaveRoom.ts:22` (warn)
- **Original claim:** `getLogger().debug('presence: user came back', { token })` (lifecycle.ts:27,:33) and `getLogger().warn('presence: no session data for given token', { token })` (leaveRoom.ts:22 — warn, fires in prod) pass the raw session token to the logger. `token` is a default-redacted key (`core/src/redactedLogKeys.ts`) but `getLogger()` does not sanitize — only `server/src/logSanitize.ts` consumes `isRedactedLogKey` — so a consumer Pino/Datadog sink persists live tokens.
- **Verification (current code):** Confirmed verbatim. `lifecycle.ts:27` = `getLogger().debug(\`presence: user came back\`, { token });`; `:33` = `getLogger().debug(\`presence: user connected\`, { token });`; `leaveRoom.ts:22` = `getLogger().warn('presence: no session data for given token', { token });`. The token in all three is the raw session token. `getLogger()` itself applies no redaction.
- **Verdict & why:** CONFIRMED. Both scans agree (both Medium) — correct. The `leaveRoom.ts:22` warn is the worst because warn is default-on in production; anyone with log access obtains a live token = session hijack until expiry. (Note: SEC-28 also references `docs/lifecycle.md:83` as "teaching the anti-pattern" — see QUA-041; the doc example is a consumer hook logging `{ token }`, a weaker concern than the code itself.)
- **Recommendation:** Log a fingerprint (`token.slice(0,8)+'…'`) or the resolved `userId`, not the raw token; or route presence log context through the server sanitizer. Fix all three call sites; `leaveRoom.ts:22` (warn) first.

### SEC-29 — `LocationProvider` transmits the full query string to the server (URL-secret leakage)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(SEC-29)
- **Current location:** `packages/presence/src/client/LocationProvider.tsx:18-26` (`:20`)
- **Original claim:** `sendLocationUpdate` copies EVERY `location.search` entry into `searchParams` and emits it; the server stores it on the session and exposes it via `onLocationUpdate`. URLs carry secrets (password-reset tokens, OAuth `code`/`state`, invite codes) which get persisted to Redis session state and potentially fanned out to peers. No allowlist/denylist/off-switch short of disabling the whole provider.
- **Verification (current code):** Confirmed. `:19-22` builds `searchParams` by iterating `new URLSearchParams(globalThis.location.search)` with no filtering, then `:25` emits `{ pathName, searchParams }`. The only gate is `getProjectConfig().locationProviderEnabled` (`:32`), an all-or-nothing switch. No per-key filter exists.
- **Verdict & why:** CONFIRMED. Any consumer enabling `locationProviderEnabled` silently persists (and potentially shows peers) whatever secrets ride in the URL. Off by default limits blast radius, hence Medium not High — agreed.
- **Recommendation:** Strip search params by default; add `registerPresenceConfig({ location: { includeSearchParams: false, searchParamFilter? } })` or a `LocationProvider` prop. At minimum drop keys matching the redacted-log-keys set (`token`, `code`, `state`).

### QUA-040 / Q1 — `lastFired` activity-throttle map grows unbounded (never pruned on disconnect)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Q1) + review(QUA-040) — both
- **Current location:** `packages/presence/src/activityEvents.ts:43-44`, written at `:78`; cleanup gap `packages/presence/src/activity/activitySampler.ts:27-29`
- **Original claim:** `const lastFired = new Map<string, number>()` keyed `${eventName}|${socketId}` is written in `dispatchActivitySample` but never deleted. `clearActivity(socketId)` purges only `lastActivityBySocket`, not `lastFired`. Socket ids are per-connection, so every socket that ever fired a throttled event leaks one entry per event forever — slow memory leak.
- **Verification (current code):** Confirmed. `activityEvents.ts:43` declares `lastFired`; `:78` does `lastFired.set(key, sample.now)` inside the refractory branch; there is no `lastFired.delete(...)` anywhere in the file. `activitySampler.ts:27-29` `clearActivity` only does `lastActivityBySocket.delete(socketId)`. No disconnect path touches `lastFired`.
- **Verdict & why:** CONFIRMED. Genuine unbounded-growth leak on any long-running deploy with refractory-throttled activity events (the built-in `'afk'` event uses `refractoryMs: 60_000`, so it populates `lastFired`). Both scans agree (Medium) — correct.
- **Recommendation:** Export a `clearActivityThrottle(socketId)` that deletes all `*|${socketId}` keys and call it from `clearActivity`; or periodically sweep keys whose `socketId` is no longer in `io.sockets.sockets`.

### M2 / D4 — No tenant scoping on socket.io room names; presence fan-out is a global room namespace  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(M2 + D4)
- **Current location:** `packages/presence/src/activity/peerNotifier.ts:39-63`; doc gap `docs/ARCHITECTURE_MULTI_TENANCY.md`
- **Original claim:** `informRoomPeers` iterates `session.roomCodes` (arbitrary client-supplied strings from `joinRoom`) and emits to every socket in each room with no tenant/workspace namespacing. Two tenants using the same room-code string share presence fan-out. Core has `registerRedisKeyFormatter` for Redis but no equivalent for socket.io room names. The multi-tenancy doc doesn't mention presence.
- **Verification (current code):** Confirmed. `peerNotifier.ts:39-40` loops `for (const room of roomCodes)` and `io.sockets.adapter.rooms.get(room)` using the raw room string — no prefix/formatter. Grep of `docs/ARCHITECTURE_MULTI_TENANCY.md` for presence/room-name namespacing: the only `presence` hits (`:131-132`) are an unrelated Redis-key example (`formatKey('presence', ...)`), nothing about socket.io room names. So D4 (doc silent on presence room namespacing) holds.
- **Verdict & why:** CONFIRMED as a real cross-tenant leakage risk *when room codes collide* + an undocumented multi-tenant footgun. Severity Medium is fair (requires colliding room codes, which a disciplined tenant-prefixing consumer avoids — but nothing enforces or documents that).
- **Recommendation:** Offer a room-name formatter hook (symmetry with `registerRedisKeyFormatter`) so presence honors a tenant prefix, OR at minimum document in `ARCHITECTURE_MULTI_TENANCY.md` that room codes must be tenant-prefixed.

### QUA-041 — Presence docs drift: still describe the token-leaking AFK broadcast and `recipientCount: -1` sentinel that no longer exist  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(QUA-041); related reports(D1, D3)
- **Current location:** `packages/presence/docs/lifecycle.md:113-114`, `:49`; `packages/presence/docs/peer-notifier.md:149`, `:182`; `packages/presence/docs/activity-broadcaster.md:170-172`; `packages/presence/docs/disconnect-grace.md:51-56,73-82`
- **Original claim:** Code was fixed but shipped docs (npm `files` includes `docs/`) still describe old behavior: (1) lifecycle.md:113 shows the default AFK event emitting `io.to(room).emit(userAfk, { token })` — actual `afkEvent.ts` routes through `informRoomPeers` emitting `{ userId, endTime }`; (2) docs claim the default 'afk' event reports `recipientCount: -1` — it now uses `informRoomPeers` with real counts; (3) `disconnect-grace.md` shows `PresenceConfig`/`DEFAULT_PRESENCE_CONFIG` without `activitySampleIntervalMs` (reports' D1).
- **Verification (current code):** Confirmed. `afkEvent.ts:15-26` calls `informRoomPeers({ token, event: userAfk, extraData: { time } })`, and `peerNotifier.ts:55-57` emits `{ userId, endTime }` (NOT `{ token }`) and increments `recipientCount` per recipient. Yet `lifecycle.md:113-114` still shows `io.to(room).emit(socketEventNames.userAfk, { token })` + `recipientCount: -1`; `peer-notifier.md:149` and `activity-broadcaster.md:170-172` still document `{ token }` room-level emit + the `-1` sentinel. So the docs describe a token broadcast that the code no longer performs.
- **Verdict & why:** CONFIRMED. Especially harmful because AI-driven consumers treat shipped docs as the contract and would code against payload shapes (`token` field, `-1` sentinel) that don't exist — or assume tokens are broadcast. This subsumes reports' D1 (stale config table) and D3 (self-contradicting peer-notifier.md:182 sentence, verified verbatim: "...no, that is misleading: `tempSocket.emit` is local only").
- **Recommendation:** Sweep `packages/presence/docs/*`: replace the AFK timeline with the `{ userId, endTime }` via `informRoomPeers` flow, delete the `-1` sentinel paragraphs, add `activitySampleIntervalMs` to the config tables, and rewrite the self-contradicting peer-notifier.md:182 bullet into a clear "informRoomPeers is local-instance fan-out" statement.

### Cross-instance hard block / MIS-014 — `informRoomPeers` is local-instance only; remote peers miss userAfk/userBack  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Hard block) + review(MIS-014) — both
- **Current location:** `packages/presence/src/activity/peerNotifier.ts:40-61`; doc gap `docs/ARCHITECTURE_MULTI_INSTANCE.md` (reports' D2)
- **Original claim:** `informRoomPeers` resolves peers via `io.sockets.adapter.rooms.get(room)` + `io.sockets.sockets.get(socketKey)` and `tempSocket.emit(...)`, which only reach locally-connected sockets. With the Redis adapter (which `@luckystack/server` always attaches), peers on other instances silently receive nothing for the `socketConnected`/`initActivityDisconnect` broadcast paths. The multi-instance doc never mentions presence.
- **Verification (current code):** Confirmed. `peerNotifier.ts:40` = `io.sockets.adapter.rooms.get(room)` (local view), `:47` = `io.sockets.sockets.get(socketKey)` (local socket), `:56`/`:59` = `tempSocket.emit(...)` (local only). Grep of `docs/ARCHITECTURE_MULTI_INSTANCE.md` for presence/userAfk/informRoomPeers/roomCode: **0 matches** (reports' D2 confirmed). Note: after the AFK fix (QUA-041), even the default AFK event now goes through this local-only path — so the prior "AFK sidesteps it via io.to(room).emit" claim in reports/ is now stale; ALL three framework broadcasts are local-only today.
- **Verdict & why:** CONFIRMED, and arguably broader than either scan stated: the AFK refactor removed the one cross-instance-capable path. Presence becomes the package that breaks the moment a second instance is added. Medium (functional, not security).
- **Recommendation:** Switch `informRoomPeers` to `await io.in(room).fetchSockets()` (RemoteSocket, adapter-aware) for the dedupe/`ignoreSelf` loop, or `io.to(room).except(...).emit(...)` for simple cases. Document the limitation in `ARCHITECTURE_MULTI_INSTANCE.md` + the package "When NOT to use" list.

### MIS-003 — No `userLeft`/offline peer event on hard disconnect or grace expiry  ·  severity: high (review) → med  ·  status: CONFIRMED
- **Sources:** review(MIS-003)
- **Current location:** `packages/presence/src/activity/lifecycle.ts:61-117` (no peer emit); grace-expiry body `:95-109`; core `socketEvents.ts` (no `userLeft`)
- **Original claim:** Only peer-facing events are `userAfk`/`userBack`; no `userLeft`/`userOffline` exists. `userAfk` fires only on `intentionalDisconnect` + AFK timeout. For the common departures (browser close, navigation, network drop) `socketDisconnecting` emits nothing to peers, and the grace-expiry timeout emits nothing — so peers show the departed user as present forever. Consumers can't fix it (timer body has no hook; `informRoomPeers` not exported).
- **Verification (current code):** Confirmed. `socketDisconnecting` (`:61-117`) arms a timer and tears down session/rooms but never calls `informRoomPeers` — no peer notification at disconnect or at grace expiry (`:95-109` does `socketLeaveRoom` + `removeSession` only). `initActivityBroadcaster` emits `userAfk` only on the `intentionalDisconnect` event (`:130`). There is no `userLeft` event name in core. The grace-expiry body also fires no hook (ties to HOK-12).
- **Verdict & why:** CONFIRMED as a real capability gap. `review/` rated it High; I'd call it Medium — it's a missing feature, not a security/data-integrity defect, and a consumer can partly work around it with a custom `ActivityEvent` + `io.to(room).emit`. But the "unfixable without forking the timer body" part is accurate. Resolving the severity disagreement: it's a genuine functional gap, severity Medium.
- **Recommendation:** Add `userLeft` to core `socketEventNames` and emit via `informRoomPeers` inside the grace-expiry timeout BEFORE `removeSession` (session lookup still works there); pairs naturally with the HOK-12 hook.

### HOK-11 — `prePresenceUpdate` dispatch result ignored: no veto (no invisible/DND mode)  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** reports(Hooks bullet) + review(HOK-11) — both
- **Current location:** `packages/presence/src/activity/peerNotifier.ts:34`
- **Original claim:** `await dispatchHook('prePresenceUpdate', {...})` discards the `DispatchResult`, so a handler returning a stop signal cannot suppress the `userAfk`/`userBack` fan-out — unlike `preRoomJoin`/`preRoomLeave` which check `preResult.stopped`. Per-user invisible/DND/hidden-observer mode is impossible without forking.
- **Verification (current code):** Confirmed. `peerNotifier.ts:34` = `await dispatchHook('prePresenceUpdate', { token, userId, kind, roomCodes });` with the return value unused; the code proceeds straight into the peer loop at `:36-63`. No `.stopped` check.
- **Verdict & why:** CONFIRMED. Audit-only hook, no veto seam — asymmetric with the room hooks. Medium (extensibility gap).
- **Recommendation:** `const pre = await dispatchHook('prePresenceUpdate', payload); if (pre.stopped) { await dispatchHook('postPresenceUpdate', { ...payload, recipientCount: 0 }); return; }` — same semantics as `preRoomJoin`. Update peer-notifier.md.

### HOK-12 — No hook fires when the disconnect grace window expires  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(HOK-12)
- **Current location:** `packages/presence/src/activity/lifecycle.ts:95-109` (timeout body)
- **Original claim:** The grace-expiry timeout — the moment a temporarily-disconnected user becomes permanently gone — dispatches no hook. Server's `onSocketDisconnect` fires immediately at disconnect (before the grace verdict); login's `pre/postSessionDelete` fire only when the session is actually deleted (conflating logout vs grace-delete, and never on the tab-switch path where `deleteSessionOnDisconnect = false`). So "mark offline in DB", "save game state", "audit final departure" have no injection point.
- **Verification (current code):** Confirmed. The `setTimeout` body (`:95-109`) calls `socketLeaveRoom` + conditional `removeSession` + a `getLogger().debug` — no `dispatchHook`. The tab-switch path sets `deleteSessionOnDisconnect = false` (`:88-91`), so on that path even `removeSession` (and thus any session-delete hook) never runs.
- **Verdict & why:** CONFIRMED. Real gap; closely tied to MIS-003 (both want a "user truly gone" injection point). Medium.
- **Recommendation:** Add `postDisconnectGraceExpired: { token, userId, roomCodes, reason, sessionDeleted }` to HookPayloads and `void dispatchHook('postDisconnectGraceExpired', ...)` after teardown.

### L1 / SEC-41 — Client-forgeable `intentionalDisconnect` opts out of disconnect session teardown  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(L1) + review(SEC-41) — both
- **Current location:** `packages/presence/src/activity/lifecycle.ts:126-133` (handler); effect `:87-91`
- **Original claim:** The `intentionalDisconnect` socket event is fully client-controlled; emitting it adds the token to `clientSwitchedTab`, which shortens the grace window AND sets `deleteSessionOnDisconnect = false`, so the session survives to TTL instead of being deleted on disconnect. A client always emitting it bypasses delete-on-disconnect. (reports' L1 also notes the `endTime` AFK spam angle.)
- **Verification (current code):** Confirmed. `initActivityBroadcaster` (`:126-133`) registers `socket.on(intentionalDisconnect, ...)` which does `clientSwitchedTab.add(token)` then `informRoomPeers(userAfk)` then `socket.disconnect(false)`. In `socketDisconnecting`, `:88-91` consumes `clientSwitchedTab` to set `deleteSessionOnDisconnect = false`. No rate-limit/refractory on the event. The client can also spam `userAfk` for its OWN identity (not another user's — userId resolved server-side).
- **Verdict & why:** CONFIRMED but correctly Low: the client only preserves/spams its OWN session (no cross-identity escalation), and the Redis TTL still bounds session lifetime. The defect is that an undocumented trust assumption (tab-switch is client-asserted) silently weakens any "delete session on disconnect" security expectation. `reports/` and `review/` agree on Low — correct.
- **Recommendation:** Document the trust model in `disconnect-grace.md` (tab-switch is client-asserted; disconnect-delete is best-effort; TTL is the real bound). Optionally ignore repeat `intentionalDisconnect` per connection. (Verified: `disconnect-grace.md` currently does NOT state this trust model.)

### C1 — Client activity-heartbeat throttle hardcoded at 10s (no config)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(C1)
- **Current location:** `packages/create-luckystack-app/template/src/_sockets/socketInitializer.ts:120,124-125`
- **Original claim:** The client `activity` emit throttle (10s) lives in the template, not in any config slot. There's a server-side `activitySampleIntervalMs` (default 15s) but no matching client-heartbeat config; the two interact (heartbeat must be < AFK threshold), yet only the server side is configurable.
- **Verification (current code):** Confirmed. `socketInitializer.ts:120` = `let lastActivitySent = 0;`, `:124` = `if (now - lastActivitySent < 10_000) { return; }`, `:125` = `lastActivitySent = now;`. Hardcoded `10_000`, no config read. (Note: this lives in the *consumer template*, Rule 7b territory — it's editable consumer code, which softens the severity.)
- **Verdict & why:** CONFIRMED, Low. A consumer tuning a fast-AFK game can't lower the client heartbeat without editing template code. Because it's template (consumer-owned) code, this is more "missing knob" than framework defect.
- **Recommendation:** If desired, surface a client-side throttle constant wired from config; otherwise document that the heartbeat is a template-level tunable.

### CFG-38 — `SocketStatusIndicator` placement/styling hardcoded; no className/position prop  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(CFG-38)
- **Current location:** `packages/presence/src/client/SocketStatusIndicator.tsx:49`
- **Original claim:** The badge renders `absolute top-2 right-2 z-50 ...` with no `className`/`position`/render-override prop; only text (`label`, `formatStatus`) and theme colors are overridable. An app with a top-right menu, or wanting it elsewhere/larger/clickable, must fork.
- **Verification (current code):** Confirmed. `:49` className is a fixed template literal `absolute top-2 right-2 z-50 ${tint} ${onTint} px-2 py-1 rounded-md text-xs font-bold pointer-events-none`. Props (`:3-18`) expose only `status`, `reconnectAttempt`, `label`, `formatStatus` — no `className`/`position`.
- **Verdict & why:** CONFIRMED, Low. Genuine but minor configurability gap; colors do follow theme tokens (good), only placement/shape are fixed.
- **Recommendation:** Add an optional `className?` merged after defaults, or a `position?: 'top-left'|'top-right'|'bottom-left'|'bottom-right'` prop, keeping current values as defaults.

### QUA-075 — Root barrel performs import-time side effect (`registerDefaultAfkEvent`) despite a `/register` entry  ·  severity: low  ·  status: PARTIALLY-FIXED
- **Sources:** review(QUA-075)
- **Current location:** `packages/presence/src/index.ts:29`
- **Original claim:** `registerDefaultAfkEvent()` executes at module load of the main barrel, while the package ships a `./register` subpath as "the side-effect entry". Any import of `@luckystack/presence` (even type-driven) mutates the global activity-event registry. Inconsistent with the package's own register-subpath pattern; makes the barrel non-pure.
- **Verification (current code):** Confirmed present: `index.ts:29` calls `registerDefaultAfkEvent()` at module top level (after a documenting comment at `:25-28` explaining the deliberate auto-register so a fresh install gets AFK detection). It IS documented as deliberate. I checked for a `register.ts` in `packages/presence/src/` — the barrel exports `registerPresenceHooks` from `./hooks` (`:35`) but I did not find a separate `register.ts` side-effect module in this package's `src/` (the `/register` subpath convention the finding references appears to be other packages' pattern, e.g. login/email). So the "despite a dedicated /register entry" premise is partly inaccurate for presence specifically.
- **Verdict & why:** PARTIALLY-FIXED / partly-misstated. The side-effect-at-barrel-load IS real and IS a non-pure import (a legitimate Low observation), but it is consciously documented (`index.ts:25-28`), and presence does not actually ship the `./register` subpath the finding implies it should defer to — so the "inconsistent with its own pattern" framing is weaker than stated. Net: a real-but-deliberate Low, not a clean defect.
- **Recommendation:** Optional — move the call into a lazy `startActivitySampler` first-start, or into the bootstrap-imported `register` side-effect convention if presence adopts it; keep `registerDefaultAfkEvent` exported for manual hosts. Low priority given the documented rationale.

### Q2 — `socketLeaveRoom` is misnamed; `socket`/`newPath` params are inert  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Q2)
- **Current location:** `packages/presence/src/activity/leaveRoom.ts:9-27`
- **Original claim:** Despite the name and `socket`+`newPath` params, the function never leaves a room — it only validates the token and returns the session. The `socket` param is unused; `newPath` does nothing.
- **Verification (current code):** Confirmed. `socketLeaveRoom` (`:9-27`) destructures only `{ token }` from its params (the type still declares `socket` and `newPath` at `:11-12`, but they are never referenced). The body does `readSession(token)` and returns `user` — no room mutation. Caller `lifecycle.ts:102` passes `socket` + `newPath: null` that have no effect.
- **Verdict & why:** CONFIRMED, Low. Leaky/misnamed abstraction; callers pass a socket + path that do nothing. (Report-don't-auto-fix territory.)
- **Recommendation:** Rename to `resolveSessionForLeave` and drop the unused `socket`/`newPath` params, OR actually implement room mutation. Surface to user, don't auto-fix.

### Q3 — Broad file-wide eslint-disable headers mask unsafe-any / loose-equality  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(Q3)
- **Current location:** `packages/presence/src/activity/peerNotifier.ts:1`; `packages/presence/src/activity/lifecycle.ts:1`
- **Original claim:** `peerNotifier.ts:1` disables 7 rules incl. `no-explicit-any`, `no-unsafe-member-access`, `no-unsafe-assignment`; `lifecycle.ts:1` disables 6 incl. `no-floating-promises`, `no-misused-promises`. File-wide disables hide future regressions (e.g. the `==` loose-equality at `peerNotifier.ts:52`).
- **Verification (current code):** Confirmed. `peerNotifier.ts:1` disables `no-explicit-any, prefer-nullish-coalescing, no-unnecessary-type-conversion, no-unsafe-member-access, no-unsafe-assignment, restrict-plus-operands, no-unnecessary-condition` (7 rules). `lifecycle.ts:1` disables `prefer-nullish-coalescing, no-floating-promises, require-await, restrict-template-expressions, no-misused-promises` (5 rules — close to the claimed 6). Loose `==` confirmed at `peerNotifier.ts:52` (`if (token == tempToken)`) and `:55`/`:58`.
- **Verdict & why:** CONFIRMED, Low. File-wide disables are real and do mask the loose-equality + unsafe-any. Stylistic/maintainability, not a runtime defect.
- **Recommendation:** Convert to line-scoped disables where the any/unsafe access genuinely needs it; tighten `==` to `===`. Report, don't auto-fix.

### MIS-013 — No presence roster/snapshot query for late joiners  ·  severity: medium  ·  status: CONFIRMED
- **Sources:** review(MIS-013)
- **Current location:** `packages/presence/src/index.ts` (barrel — no roster export); `activitySampler.ts:19` (`lastActivityBySocket` module-private)
- **Original claim:** Presence is delta-only (`userAfk`/`userBack`). A client joining mid-session can't fetch the current roster ("who is in room X and who is idle"). The raw ingredients exist server-side (`io.sockets.adapter.rooms`, `lastActivityBySocket`) but `lastActivityBySocket` is module-private, so even a consumer `_api` route can't compute AFK-ness without forking.
- **Verification (current code):** Confirmed. `index.ts` exports no roster/`getRoomPresence` helper. `activitySampler.ts:19` = `const lastActivityBySocket = new Map<string, number>();` is module-private — only `recordActivity`/`clearActivity` (write) are exported, no read accessor. So a consumer cannot read per-socket last-activity to compute presence/AFK state for a roster.
- **Verdict & why:** CONFIRMED. Real missing-feature for the package's stated multiplayer/collab late-joiner use case. Medium.
- **Recommendation:** Export a `getRoomPresence(roomCode)` server helper built on the adapter + a read accessor for `lastActivityBySocket`, and document wiring it into a consumer `_api`; or ship a `getRoomPresence` socket event symmetric to `getJoinedRooms`.

### M-spoof note — Identity/room spoofing of presence  ·  severity: (probed) → n/a  ·  status: REFUTED
- **Sources:** reports(High note) — both scans probed this
- **Current location:** `packages/presence/src/activity/peerNotifier.ts:32,56,59`
- **Original claim:** (Probed concern) a client could claim another user's presence / spoof the broadcast identity.
- **Verification (current code):** The broadcast `userId` is always `session.id` resolved server-side from `readSession(token)` (`peerNotifier.ts:24,32`), and emitted as `{ userId: session.id, ... }` at `:56`/`:59`. The client never supplies the userId in the payload. So a client cannot make presence appear as another user.
- **Verdict & why:** REFUTED (correctly, per `reports/`). Identity-spoofing is well-handled; re-confirmed against current code. No critical/high security hole here.
- **Recommendation:** None.

### Q4 — `socketDisconnecting` does multiple jobs but within size budget  ·  severity: low  ·  status: REFUTED (as a defect)
- **Sources:** reports(Q4)
- **Current location:** `packages/presence/src/activity/lifecycle.ts:61-117`
- **Original claim:** `socketDisconnecting` (~56 lines) handles ignore-reason filtering, dedupe, tab-switch flag, timer scheduling, session teardown; the nested `setTimeout` with three early-returns is dense.
- **Verification (current code):** The function is ~56 lines (`:61-117`) and does handle several concerns, but `reports/` itself rated it "within size budget / not a god function / low priority."
- **Verdict & why:** REFUTED as an actionable defect — it's a readability nit the original author already de-prioritized. No change warranted beyond optional per-guard comments.
- **Recommendation:** Optional: a comment per early-return in the timeout closure. Not a real issue.

### D1 — Stale `PresenceConfig` table in disconnect-grace.md (missing `activitySampleIntervalMs`)  ·  severity: low  ·  status: CONFIRMED (folded into QUA-041)
- **Sources:** reports(D1)
- **Current location:** `packages/presence/docs/disconnect-grace.md:51-57,73-83`
- **Original claim:** The `PresenceConfig`/`DEFAULT_PRESENCE_CONFIG` blocks omit `activitySampleIntervalMs`, which is a real field (`presenceConfig.ts:61`, default 15_000).
- **Verification (current code):** `presenceConfig.ts:55-61` defines `activitySampleIntervalMs` (default `15_000` at `:73`). The review scan's QUA-041 lists the same disconnect-grace.md omission; treated as one doc-drift cluster.
- **Verdict & why:** CONFIRMED, Low — same root cause as QUA-041 (doc/code drift). Fix together.
- **Recommendation:** Add `activitySampleIntervalMs` to the config interface table + defaults block in disconnect-grace.md.

### D2 — Multi-instance doc omits presence entirely  ·  severity: low  ·  status: CONFIRMED (folded into cross-instance finding)
- **Sources:** reports(D2)
- **Current location:** `docs/ARCHITECTURE_MULTI_INSTANCE.md`
- **Original claim:** The doc has zero matches for presence/userAfk/informRoomPeers/disconnectTimers; given the cross-instance hard block, its symptom→cause→fix table should list "roommates on other instances don't see userBack/userAfk".
- **Verification (current code):** Grep confirmed 0 presence-related matches in `docs/ARCHITECTURE_MULTI_INSTANCE.md`.
- **Verdict & why:** CONFIRMED, Low — documentation gap accompanying the cross-instance/MIS-014 finding.
- **Recommendation:** Add a presence row to the multi-instance symptom→cause→fix table.
