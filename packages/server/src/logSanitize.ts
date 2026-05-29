//? Recursive log sanitizer: never log known-sensitive keys. Reads the
//? extensible redacted-key registry from core so feature packages can register
//? their own domain-specific keys (password, apiKey, mrn, etc.) at boot.

import { getProjectConfig, isRedactedLogKey } from '@luckystack/core';

const REDACTED_PLACEHOLDER = '[REDACTED]';

const isRedactedKey = (key: string): boolean => {
  if (isRedactedLogKey(key)) return true;
  return key.toLowerCase() === getProjectConfig().http.sessionCookieName.toLowerCase();
};

export const sanitizeForLog = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeForLog(entry));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedactedKey(key) ? REDACTED_PLACEHOLDER : sanitizeForLog(val);
  }
  return out;
};
