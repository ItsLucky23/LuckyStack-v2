//? Shared config-merge utilities. Every `@luckystack/*` config registry
//? (projectConfig, avatarConfig, and — after this lands — email/presence/
//? error-tracking) deep-merges a consumer's deep-partial override over a
//? built-in default. This module is the single implementation so a merge
//? bug is fixed once for everyone.
//?
//? Behaviour contract (must match the historical hand-rolled copies exactly):
//?   - `override === undefined` → return `base` untouched.
//?   - When either side is not a plain object (arrays, primitives, class
//?     instances, null) → the override replaces the base wholesale
//?     (`override ?? base`). Arrays are therefore replaced, never merged.
//?   - Otherwise merge key-by-key: `undefined` override values are skipped
//?     (the base value wins), nested plain objects recurse, everything else
//?     replaces.
//?
//? Added over the historical copies: a depth + circular-reference guard so a
//? pathological override (self-referential object or absurd nesting) degrades
//? to a wholesale replace instead of overflowing the stack. Real config trees
//? are a handful of levels deep, so the guard never triggers in practice and
//? behaviour is identical to the old implementations.

/** Maximum recursion depth before the merge stops descending and replaces wholesale. */
const MAX_MERGE_DEPTH = 100;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? DeepPartial<NonNullable<T[K]>> : T[K];
};

/**
 * True when `value` is a plain object literal (prototype is `Object.prototype`
 * or `null`). Arrays, class instances, Maps, Dates, and `null` are rejected so
 * they are treated as opaque replacement values during a merge.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const deepMergeInternal = <T>(
  base: T,
  override: DeepPartial<T> | undefined,
  depth: number,
  seen: WeakSet<object>,
): T => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  //? Depth / circular guard: if we have descended too far, or the override
  //? object has already been visited on this branch (self-reference), stop
  //? recursing and replace wholesale. Normal config trees never reach this.
  if (depth >= MAX_MERGE_DEPTH || seen.has(override)) {
    return (override as T) ?? base;
  }
  seen.add(override);

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, overrideValue] of Object.entries(override as Record<string, unknown>)) {
    if (overrideValue === undefined) continue;
    //? Prototype-pollution guard: never let an override key reassign the
    //? prototype chain. Cheap defensive skip on the shared merge primitive
    //? every config registry routes through (the contract invites consumer
    //? partials, e.g. a `JSON.parse`d `{"__proto__":{...}}`).
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(overrideValue)
        ? deepMergeInternal(baseValue, overrideValue as DeepPartial<unknown>, depth + 1, seen)
        : overrideValue;
  }
  return result as T;
};

/**
 * Deep-merge a deep-partial `override` over a fully-populated `base`,
 * returning a new object. See the module header for the exact behaviour
 * contract. Arrays and non-plain-object values are replaced wholesale; nested
 * plain objects merge recursively; `undefined` override values are ignored.
 */
export const deepMerge = <T>(base: T, override: DeepPartial<T> | undefined): T =>
  deepMergeInternal(base, override, 0, new WeakSet<object>());
