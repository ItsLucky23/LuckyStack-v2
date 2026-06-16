//? Log a non-reversible fingerprint of a session token instead of the raw
//? value. `token` is a default-redacted log key, but `getLogger()` does not
//? sanitize — only the server log pipeline does — so a raw token written here
//? would persist verbatim in a consumer Pino/Datadog sink (= session hijack
//? until expiry). The first 8 chars are enough to correlate log lines without
//? being usable as a credential.
//?
//? Single shared implementation so a redaction-policy change touches one site
//? (was previously duplicated verbatim across lifecycle.ts and leaveRoom.ts).
export const tokenFingerprint = (token: string): string =>
  token.length > 8 ? `${token.slice(0, 8)}…` : '…';
