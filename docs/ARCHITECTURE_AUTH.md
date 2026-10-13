# Authentication architecture

Authentication is provided by `@luckystack/login` rather than built into the server. Credentials and external providers ultimately create sessions through the active session adapter; application-specific authorization remains the consumer's responsibility. For provider adoption see the installed login README or [framework guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/login/README.md); exact endpoint contracts live in installed declarations.

## Security boundaries

- OAuth state must be short-lived, single-use and verified before accepting a callback. Without it a login callback can be forged across browser sessions.
- Origin restrictions and HTTP CSRF checks are separate from proving identity. State-changing requests without a trustworthy origin are rejected by default; server-to-server webhooks require an explicit, narrowly scoped exception **and their own authentication**. See [HTTP architecture](./ARCHITECTURE_HTTP.md).
- Cookie mode keeps the session credential out of page JavaScript; the alternative browser-held token mode deliberately expands exposure and is useful for tab-scoped development. Do not send a raw session token inside a client-visible session object in either mode. See [session architecture](./ARCHITECTURE_SESSION.md) and ADR 0018.
- Passwords must be hashed, not HTML-escaped before checking or storing: escaping mutates legitimate credentials without protecting HTML. User-controlled display text needs output-safe handling.
- Passwordless requests must avoid revealing whether an account exists. Password-reset tokens are single-use: a veto after consumption burns the link rather than leaving a replayable credential; a rejected user must request a new link. See `src/reset-password/_api/confirmReset_v1.ts`.
- Second-factor enrolment must not silently overwrite an enrolled factor merely because a session was hijacked. Recovery codes are a separate lost-device path. Email fallback is convenient but makes mailbox ownership sufficient to finish a challenge, weakening the separation between factors. Rate limiting needs both per-challenge and per-account protection so distributing attempts across IPs does not remove the limit. See ADR 0024 and the login package for current policy.
- Diagnostic reset endpoints must fail closed outside their explicitly authorized test environment; see [hosting](./HOSTING.md) before exposing one.

## Existing-project adoption

Enabling email-code or two-factor login in an existing project requires more than installing a package: confirm the email sender, persist the necessary optional user data, protect the TOTP encryption key and retain old keys through rotation, then merge consumer-owned UI updates instead of overwriting local changes. Without the sender mail cannot be delivered; without persistence enrolment fails; without a primary encryption key newly enrolled secrets risk plaintext storage. Follow the existing-project adoption checklist in the installed login README ([framework guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/login/README.md)) and [`UPGRADING.md`](./UPGRADING.md), review the proposed file changes, and do not remove legacy decryption keys until old records are migrated.
