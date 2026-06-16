import { createHash } from 'node:crypto';

//? N-3: the per-route rate-limit bucket must stay STABLE per session (the same
//? token maps to the same bucket) WITHOUT ever placing the raw session token
//? into a Redis key name or a dev log line (CLAUDE.md "never the raw token"
//? invariant). A SHA-256 prefix is deterministic + non-reversible: identical
//? bucket identity, opaque on the wire. Truncated to 32 hex chars (128 bits) —
//? ample collision resistance for a per-route rate-limit namespace.
const TOKEN_HASH_LENGTH = 32;

/**
 * Derive the deterministic, non-reversible bucket component for a session
 * token. The same token always yields the same value (bucket identity is
 * preserved) while the raw token never appears in the returned string.
 */
export const deriveTokenBucketId = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, TOKEN_HASH_LENGTH);
