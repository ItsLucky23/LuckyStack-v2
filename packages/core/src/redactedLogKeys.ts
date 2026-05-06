//? Registry of log keys that get masked when the framework prints request /
//? response payloads. Feature packages register their domain-specific
//? sensitive keys at boot (login → `password`, email → `apiKey`, etc.) so a
//? consumer of the package never has to remember to extend a static list in
//? core to keep their own data out of logs.
//?
//? Lookups are case-insensitive. Keys are merged with the framework defaults;
//? `registerRedactedLogKeys` is additive — duplicate calls are idempotent.

const DEFAULT_REDACTED_LOG_KEYS: readonly string[] = [
  'password',
  'confirmpassword',
  'token',
  'newtoken',
  'authorization',
  'cookie',
  'set-cookie',
];

const redactedKeys = new Set<string>(DEFAULT_REDACTED_LOG_KEYS.map((key) => key.toLowerCase()));

export const registerRedactedLogKeys = (keys: readonly string[]): void => {
  for (const key of keys) {
    redactedKeys.add(key.toLowerCase());
  }
};

export const getRedactedLogKeys = (): readonly string[] => [...redactedKeys];

export const isRedactedLogKey = (key: string): boolean => {
  return redactedKeys.has(key.toLowerCase());
};

//? Test-only helper — restore the default seed set between integration tests.
//? Never call from production code; framework packages register their own
//? keys at boot and clearing would re-expose them.
export const resetRedactedLogKeysForTests = (): void => {
  redactedKeys.clear();
  for (const key of DEFAULT_REDACTED_LOG_KEYS) {
    redactedKeys.add(key.toLowerCase());
  }
};
