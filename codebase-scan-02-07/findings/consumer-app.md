# Consumer App Security + Correctness Audit — 2026-07-02

Scope: `src/` (pages, `_api/`, `_sync/`, `_functions/`, `_components/`, `_providers/`),
consumer route handlers, `functions/` shims, and the consumer `prisma/schema.prisma`.
SCAN ONLY — no files were modified.

General note: this consumer app is unusually hardened. Route handlers carry extensive
security rationale, use anti-enumeration on reset/email-change, route session/user
mutations through adapters, cap stream fan-out, and the framework enforces Zod input
validation (generated `apiInputSchemas`) in prod (`validation.runtimeMode: 'enforce'`).
Several "obvious" bugs were checked and REFUTED (see the "Verified NOT a bug" section).
The findings below are the residue after that filtering.

---

## FINDINGS

### 1. HIGH — Session-fetch endpoint returns the raw session `token` to client JS (HttpOnly bypass)

- **File:** `src/_api/session_v1.ts` (route `api/system/session/v1`), line 16-21.
- **Sibling test:** `src/_api/session_v1.tests.ts` EXISTS, but does not assert the token is absent from the response.

```ts
export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: user,          // <-- returns the FULL SessionLayout, including user.token
  };
};
```

**Why it's wrong / failure scenario.** This is the endpoint the client bootstraps from:
`src/_providers/SessionProvider.tsx` line 84 calls `apiRequest({ name: 'system/session', version: 'v1' })`
and stores `response.result` in React state. The injected `user` object carries the raw
session token — the framework's `getSession` re-attaches it on every read
(`packages/login/src/session.ts:341` → `const merged = { ...parsed, token };`), which is
why handlers can use `user.token`. Returning `result: user` verbatim therefore ships the
live session credential to page JavaScript.

In the default **cookie mode** (`sessionBasedToken: false`, which is what `config.ts`
sets for `staging.server.com` and `app.server.com`), the token lives in an HttpOnly cookie
precisely so XSS cannot read it. This route hands it back to JS anyway, so any XSS can do
`(await apiRequest({name:'system/session', version:'v1'})).result.token` (or read
SessionProvider state) and exfiltrate a long-lived (7-day) session token. This directly
contradicts the security design stated verbatim in the sibling `listSessions_v1.ts`
(lines 20-25): *"The raw token is the HttpOnly-cookie credential, so it must NEVER reach
page JS."* The client never needs `token` in cookie mode (the cookie authenticates both
the socket handshake and `apiRequest`), and in token mode it already obtains the token from
the `x-session-token` login header — so returning it here is unnecessary in both modes.

**Caveat (verified, honesty):** the framework's own `updateSession` broadcast also emits a
token-bearing payload (`packages/login/src/session.ts:244` emits `persisted`, from which
only the *stored* copy — not the broadcast copy — has `token` stripped at line 157). So the
token reaches the browser through more than one path; fixing this route alone is
defense-in-depth, not a complete cure. But `session_v1` is squarely in consumer scope and
is the primary, pull-able exfiltration surface, so it should strip `token` before
returning (e.g. `const { token: _t, ...safe } = user; return { status:'success', result: safe }`).
`csrfToken` may legitimately stay (double-submit CSRF needs JS to read it).

---

### 2. MEDIUM — `User.email` has no `@unique`; email-change/register race backstop the code relies on does not exist

- **File:** `prisma/schema.prisma`, line 65 (`email String` — no `@unique`).
- **Depends-on code:** `src/settings/_api/confirmEmailChange_v1.ts` lines 51-57 + 78-84, and
  `src/settings/_api/requestEmailChange_v1.ts` lines 85-100.

`confirmEmailChange_v1` justifies its non-transactional collision check with
(line 80-81): *"the DB unique index on email is the real race backstop; the check itself is
not transactional."* But the schema declares `email String` with **no `@unique`
constraint**, so that backstop is absent.

**Failure scenario.** Two concurrent `confirmEmailChange` calls (or a `register` racing a
confirm) that both target the same new address both pass the `findFirst` collision check
(TOCTOU) and both `update`/`create`, producing two user rows with the same email. Login and
password-reset resolve users by email (`findFirst`/`findUnique` on email), so duplicate
rows make account resolution ambiguous and can shadow the wrong account. Severity is MEDIUM
because it needs concurrency to trigger, but the guard the code documents simply isn't
there. Fix: add `@unique` to `email` (note: on MongoDB this is `@unique` on the field; a
partial index may be wanted if empty emails are possible).

---

### 3. LOW — `updateUser_v1`: avatar written to disk before the un-guarded DB write

- **File:** `src/settings/_api/updateUser_v1.ts`, lines 73-107.
- **Sibling test:** `updateUser_v1.tests.ts` exists.

The avatar is `sharp`-encoded and written to `${user.id}.webp` (lines 73-85) BEFORE the
`prisma.user.update` (lines 104-107), and that update — unlike its siblings
(`updatePreferences_v1` wraps in `.catch(() => null)` → `common.500`) — is NOT wrapped in
`tryCatch`. If the DB write throws (transient error), the avatar file is already on disk
and the session is NOT updated, yet the framework normalizes the throw to a generic
`api.internalServerError` rather than a clean domain errorCode. Net effect: an orphaned
avatar file plus an inconsistent "half-applied" result on a DB blip. Low impact
(self-heals on the next successful save), but inconsistent with the sibling handlers'
explicit `common.500` handling.

Also note (NOT a bug, just redundancy): `LANGUAGE_RE` (line 13) accepts any well-formed
locale (`es`, `pt-BR`, …), which is broader than the DB `LANGUAGE` enum (`nl|en|de|fr`).
This is harmless because the generated Zod schema
(`apiInputSchemas.generated.ts:66`) already restricts `language` to the enum literals and
runs before `main()`, so a non-enum value is rejected at validation, never reaching Prisma.

---

### 4. LOW / INFORMATIONAL — Admin route authorization is client-side only

- **File:** `src/admin/page.tsx`, lines 11-16.

`/admin` is gated exclusively by a client-side `PageMiddleware` (`session.admin`). That is
fine TODAY because the page renders only a static translated title — there is no
server-side data behind it and no admin `_api/` route. Flagging as informational so it is
not mistaken for a server-side authorization boundary: `PageMiddleware` runs in the
browser and is trivially bypassable. If any admin-only data or mutation endpoint is added
later, it MUST enforce `auth: { login: true, additional: [<admin predicate>] }` in the
`_api` handler — the page guard is UX, not security.

---

### 5. LOW — Test-coverage gaps on the shipped example service routes

- **Files:** `src/billing/_api/listInvoices_v1.ts`, `src/vehicles/_api/listVehicles_v1.ts`.

Neither route has a sibling `_v1.tests.ts` (confirmed: the `_api` folders contain only the
handler). They are auth-gated stubs returning empty arrays with `ownerId: user.id` and take
no client-supplied ids, so there is no IDOR or injection surface — but they ship as
copy-me examples with `login: true` and no business-logic test, which undercuts the
"per-route business-logic test" convention new endpoints are meant to follow. Recommend
adding at least a happy-path + auth-enforcement test, or a comment that the auto-sweep is
the only intended coverage for these stubs.

---

## Verified — NOT a bug (checked to avoid false positives)

- **`language` enum drift in `updateUser_v1`** — REFUTED. The generated Zod schema
  (`apiInputSchemas.generated.ts:65-66`) enforces `nl|en|de|fr` and `dark|light` before the
  handler runs (prod validation is on by default), so malformed-but-well-formed locales are
  rejected at validation, not with a Prisma 500.
- **`data.token.trim()` / `data.email.trim()` on unauthenticated routes**
  (`confirmEmailChange_v1`, `sendReset_v1`, `confirmReset_v1`, `testEmail_v1`) — safe:
  the framework validates input shape (string) via the generated schemas before `main()`.
- **`revokeSession_v1` IDOR** — REFUTED. The opaque handle is resolved by re-hashing only
  THIS user's own active tokens and re-checking `parsed.id === user.id`; a caller can only
  ever target a session they own, and refuses the current session.
- **`streamToToken_server_v1` open relay** — mitigated: `login: true` + `MAX_TARGETS = 10`
  cap, and DEV-only intent is documented.
- **Sync fan-out to arbitrary rooms** (`echo_server_v1` etc., `login:false`) — mitigated by
  framework defaults `sync.requireRoomMembership: true` / `sync.allowClientReceiverAll:false`
  (0.2.0).
- **XSS via `dangerouslySetInnerHTML` / `innerHTML` / `eval`** — none present anywhere in
  `src/` (grep clean). All user text renders through React escaping + `useTranslator`.
- **Anti-enumeration** on `requestEmailChange_v1` / `sendReset_v1` is correctly implemented
  (silent success on taken/unknown address).
- **`functions/*` shims** (db, redis, sentry, session) are pure re-exports — no logic bugs.

---

## Test-coverage summary

Most `_api`/`_sync` routes have sibling `_v<N>.tests.ts` files. Gaps found:
`src/billing/_api/listInvoices_v1.ts` and `src/vehicles/_api/listVehicles_v1.ts` (no tests,
Finding 5). `session_v1.tests.ts` exists but does not assert token-absence in the response
(relevant to Finding 1).
