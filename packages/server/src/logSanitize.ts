//? Recursive log sanitizer: never log known-sensitive keys (passwords, tokens,
//? cookies). Used by the framework's request-logging path. Project code can
//? extend the redacted-keys set later via a config option if needed.

import { serverRuntimeConfig } from '@luckystack/core';

const sessionCookieName = serverRuntimeConfig.http.sessionCookieName.toLowerCase();

const REDACTED_LOG_KEYS = new Set([
  'password',
  'confirmpassword',
  'token',
  'newtoken',
  'authorization',
  'cookie',
  'set-cookie',
  sessionCookieName,
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';

export const sanitizeForLog = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeForLog(entry));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_LOG_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED_PLACEHOLDER;
    } else {
      out[key] = sanitizeForLog(val);
    }
  }
  return out;
};
