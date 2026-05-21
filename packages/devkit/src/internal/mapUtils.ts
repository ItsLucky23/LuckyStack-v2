//? Internal map utilities for devkit. Replace the `map.get(key)!` pattern
//? (banned by the strict-typing policy) with helpers that either
//? lazily initialize an entry (`getOrInit`) or throw a labelled error
//? when the invariant breaks (`mustGet`). Both surface the actual
//? failure site instead of silently producing `undefined`.

export const getOrInit = <K, V>(map: Map<K, V>, key: K, factory: () => V): V => {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const fresh = factory();
  map.set(key, fresh);
  return fresh;
};

export const mustGet = <K, V>(map: Map<K, V>, key: K, label: string): V => {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`[devkit] invariant violation: '${String(key)}' missing from ${label}`);
  }
  return value;
};
