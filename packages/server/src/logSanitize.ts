//? Recursive log sanitizer: never log known-sensitive keys. Reads the
//? extensible redacted-key registry from core so feature packages can register
//? their own domain-specific keys (password, apiKey, mrn, etc.) at boot.

import { getProjectConfig, isRedactedLogKey } from '@luckystack/core';

const REDACTED_PLACEHOLDER = '[REDACTED]';
const TRUNCATED_PLACEHOLDER = '[TRUNCATED]';

//? Bound recursion so an attacker-supplied deeply-nested JSON body (within the
//? request body cap) cannot stack-overflow the dev-log sanitizer. Past this
//? depth we emit a sentinel instead of recursing further.
const MAX_SANITIZE_DEPTH = 40;

const isRedactedKey = (key: string): boolean => {
  if (isRedactedLogKey(key)) return true;
  return key.toLowerCase() === getProjectConfig().http.sessionCookieName.toLowerCase();
};

const sanitizeWithGuards = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value !== 'object') return value;
  //? Cycle guard: a self-referential object would otherwise recurse forever.
  if (seen.has(value)) return TRUNCATED_PLACEHOLDER;
  if (depth >= MAX_SANITIZE_DEPTH) return TRUNCATED_PLACEHOLDER;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeWithGuards(entry, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isRedactedKey(key) ? REDACTED_PLACEHOLDER : sanitizeWithGuards(val, depth + 1, seen);
    }
    return out;
  } finally {
    //? Allow the same object to appear in sibling branches (shared, not cyclic).
    seen.delete(value);
  }
};

export const sanitizeForLog = (value: unknown): unknown => sanitizeWithGuards(value, 0, new WeakSet());
