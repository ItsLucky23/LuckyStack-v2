import tryCatchSync from './tryCatchSync';

type ValidationResult =
  | { status: 'success' }
  | { status: 'error'; message: string };

  interface ParsedObjectField {
  key: string;
  optional: boolean;
  type: string;
}

interface ParsedObjectIndexSignature {
  keyName: string;
  keyType: string;
  type: string;
}

const splitTopLevel = (value: string, splitter: '|' | '&'): string[] => {
  const items: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let token = '';

  for (const char of value) {
    if (char === '(') depthParen += 1;
    if (char === ')') depthParen -= 1;
    if (char === '{') depthBrace += 1;
    if (char === '}') depthBrace -= 1;
    if (char === '[') depthBracket += 1;
    if (char === ']') depthBracket -= 1;

    if (char === splitter && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      items.push(token.trim());
      token = '';
      continue;
    }

    token += char;
  }

  if (token.trim()) items.push(token.trim());
  return items;
};

const parseObjectFields = (typeText: string): {
  fields: ParsedObjectField[];
  indexSignatures: ParsedObjectIndexSignature[];
} => {
  const clean = typeText.trim();
  if (!clean.startsWith('{') || !clean.endsWith('}')) {
    return { fields: [], indexSignatures: [] };
  }

  const inner = clean.slice(1, -1);
  const fields: ParsedObjectField[] = [];
  const indexSignatures: ParsedObjectIndexSignature[] = [];

  let part = '';
  let depth = 0;
  for (const char of inner) {
    if (char === '{' || char === '[' || char === '(' || char === '<') depth += 1;
    if (char === '}' || char === ']' || char === ')' || char === '>') depth -= 1;

    if (char === ';' && depth === 0) {
      const trimmed = part.trim();
      if (trimmed) {
        const fieldMatch = /^("|')?[A-Za-z_][A-Za-z0-9_]*("|')?(\?)?\s*:\s*([\s\S]+)$/.exec(trimmed);
        if (fieldMatch) {
          const keyMatch = /^("|')?[A-Za-z_][A-Za-z0-9_]*("|')?/.exec(trimmed);
          const rawKey = keyMatch?.[0] ?? '';
          fields.push({
            key: rawKey.replaceAll(/^['"]|['"]$/g, ''),
            optional: Boolean(fieldMatch[3]),
            type: (fieldMatch[4] ?? '').trim(),
          });
        } else {
          const indexMatch = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\]\s*:\s*([\s\S]+)$/.exec(trimmed);
          if (indexMatch) {
            indexSignatures.push({
              keyName: (indexMatch[1] ?? '').trim(),
              keyType: (indexMatch[2] ?? '').trim(),
              type: (indexMatch[3] ?? '').trim(),
            });
          }
        }
      }
      part = '';
      continue;
    }

    part += char;
  }

  const final = part.trim();
  if (final) {
    const fieldMatch = /^("|')?[A-Za-z_][A-Za-z0-9_]*("|')?(\?)?\s*:\s*([\s\S]+)$/.exec(final);
    if (fieldMatch) {
      const keyMatch = /^("|')?[A-Za-z_][A-Za-z0-9_]*("|')?/.exec(final);
      const rawKey = keyMatch?.[0] ?? '';
      fields.push({
        key: rawKey.replaceAll(/^['"]|['"]$/g, ''),
        optional: Boolean(fieldMatch[3]),
        type: (fieldMatch[4] ?? '').trim(),
      });
    } else {
      const indexMatch = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\]\s*:\s*([\s\S]+)$/.exec(final);
      if (indexMatch) {
        indexSignatures.push({
          keyName: (indexMatch[1] ?? '').trim(),
          keyType: (indexMatch[2] ?? '').trim(),
          type: (indexMatch[3] ?? '').trim(),
        });
      }
    }
  }

  return { fields, indexSignatures };
};

const matchesIndexKeyType = ({ keyType, key }: { keyType: string; key: string }): boolean => {
  const normalized = keyType.trim();
  if (normalized === 'string') return true;
  if (normalized === 'number') return /^-?\d+(\.\d+)?$/.test(key);
  if (normalized.includes('|')) {
    const parts = splitTopLevel(normalized, '|').map((part) => part.trim());
    return parts.some((part) => matchesIndexKeyType({ keyType: part, key }));
  }
  if ((normalized.startsWith("'") && normalized.endsWith("'")) || (normalized.startsWith('"') && normalized.endsWith('"'))) {
    return key === normalized.slice(1, -1);
  }
  return false;
};

const isPrimitiveMatch = (type: string, value: unknown): boolean => {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'true') return value === true;
  if (type === 'false') return value === false;
  if (type === 'null') return value === null;
  if (type === 'undefined') return value === undefined;
  if (type === 'Date') return typeof value === 'string' || value instanceof Date;
  return false;
};

const isPrimitiveType = (type: string): boolean => {
  return ['string', 'number', 'boolean', 'true', 'false', 'null', 'undefined', 'Date'].includes(type);
};

//? Prototype-pollution guard: own-keys that must never be accepted as object /
//? Record entries on the input boundary, regardless of the declared value type.
//? An attacker smuggling `{"__proto__": {...}}` into a `Record<string, …>` (or
//? an index-signature object) could otherwise reach a handler that spreads or
//? deep-assigns the payload.
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

//? Split a `Record<K, V>` type text into its key and value type at the TOP-LEVEL
//? comma (so a nested `Record<string, { a: number }>` or a union value keeps its
//? own commas). Returns null when the head/value can't be isolated.
const parseRecordParts = (type: string): { keyType: string; valueType: string } | null => {
  const inner = type.slice('Record<'.length, -1);
  let depth = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === '<' || char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '>' || char === '}' || char === ']' || char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      return {
        keyType: inner.slice(0, index).trim(),
        valueType: inner.slice(index + 1).trim(),
      };
    }
  }
  return null;
};

//? Recursion-depth ceiling for `validateType`. The TYPE text is build-time
//? fixed, but the VALUE is attacker-controlled: a deeply-nested array/object
//? payload (within `requestBodyMaxBytes`) drives recursion proportional to its
//? nesting and could blow the stack before the handler runs (cheap DoS). 64 is
//? far deeper than any realistic typed payload while still bounding the stack.
const MAX_VALIDATION_DEPTH = 64;

const validateType = (typeText: string, value: unknown, path: string, depth = 0): ValidationResult => {
  if (depth > MAX_VALIDATION_DEPTH) {
    return { status: 'error', message: `${path}: input nesting exceeds the maximum depth of ${String(MAX_VALIDATION_DEPTH)}` };
  }

  const type = typeText.trim();

  if (type.startsWith('__RUNTIME_UNRESOLVED__::')) {
    const unresolvedMessage = type.replace('__RUNTIME_UNRESOLVED__::', '').trim();
    return { status: 'error', message: `${path}: ${unresolvedMessage}` };
  }

  if (type.startsWith('(') && type.endsWith(')')) {
    return validateType(type.slice(1, -1), value, path, depth + 1);
  }

  if (type.includes('|')) {
    const unionParts = splitTopLevel(type, '|').filter(Boolean);
    if (unionParts.length > 1) {
      for (const unionType of unionParts) {
        const result = validateType(unionType, value, path, depth + 1);
        if (result.status === 'success') return result;
      }
      return { status: 'error', message: `${path} does not match union type ${type}` };
    }
  }

  if (type.includes('&')) {
    const intersectionParts = splitTopLevel(type, '&').filter(Boolean);
    if (intersectionParts.length > 1) {
      for (const intersectionType of intersectionParts) {
        const result = validateType(intersectionType, value, path, depth + 1);
        if (result.status === 'error') return result;
      }
      return { status: 'success' };
    }
  }

  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) {
      return { status: 'error', message: `${path} should be an array` };
    }
    const itemType = type.slice(0, -2).trim();
    if (itemType === '' || itemType === type) {
      //? FAIL CLOSED: the element type was unsplittable from the `[]` suffix
      //? (defensive — should be unreachable). Don't pass an array of arbitrary
      //? elements unvalidated; surface it so the route author models it.
      return { status: 'error', message: `${path}: unvalidatable array element type for ${type}` };
    }
    for (const [index, element] of value.entries()) {
      const result = validateType(itemType, element, `${path}[${String(index)}]`, depth + 1);
      if (result.status === 'error') return result;
    }
    return { status: 'success' };
  }

  if ((type.startsWith("'") && type.endsWith("'")) || (type.startsWith('"') && type.endsWith('"'))) {
    const literal = type.slice(1, -1);
    return value === literal
      ? { status: 'success' }
      : { status: 'error', message: `${path} should equal ${literal}` };
  }

  if (isPrimitiveMatch(type, value)) {
    return { status: 'success' };
  }

  if (isPrimitiveType(type)) {
    const expectedType = type === 'Date' ? 'Date (ISO string or Date)' : type;
    return { status: 'error', message: `${path} should be ${expectedType}` };
  }

  if (type === 'any' || type === 'unknown') {
    return { status: 'success' };
  }

  if (/^Record<.+>$/.test(type)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { status: 'error', message: `${path} should be an object` };
    }

    const record = value as Record<string, unknown>;
    const recordParts = parseRecordParts(type);

    for (const key of Object.keys(record)) {
      //? Reject prototype-polluting own-keys unconditionally.
      if (PROTO_POLLUTION_KEYS.has(key)) {
        return { status: 'error', message: `${path}.${key} is not allowed` };
      }

      if (!recordParts) continue;

      //? Validate the key against K (only the cheap string/number/literal forms
      //? `matchesIndexKeyType` understands; an unrecognized K leaves the key
      //? unconstrained, same as an index signature).
      if (
        (recordParts.keyType === 'number' || recordParts.keyType.includes('|') ||
          recordParts.keyType.startsWith("'") || recordParts.keyType.startsWith('"')) &&
        !matchesIndexKeyType({ keyType: recordParts.keyType, key })
      ) {
        return { status: 'error', message: `${path}.${key} is not allowed` };
      }

      //? Validate each value against V — previously skipped entirely, so a
      //? `Record<string, number>` accepted `{ a: '<script>' }`.
      const valueResult = validateType(recordParts.valueType, record[key], `${path}.${key}`, depth + 1);
      if (valueResult.status === 'error') return valueResult;
    }

    return { status: 'success' };
  }

  if (type.startsWith('{') && type.endsWith('}')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { status: 'error', message: `${path} should be an object` };
    }

    const { fields, indexSignatures } = parseObjectFields(type);
    const input = value as Record<string, unknown>;

    for (const field of fields) {
      const fieldValue = input[field.key];
      if (fieldValue === undefined) {
        if (field.optional) continue;
        return { status: 'error', message: `${path}.${field.key} is required` };
      }

      const result = validateType(field.type, fieldValue, `${path}.${field.key}`, depth + 1);
      if (result.status === 'error') return result;
    }

    const allowedKeys = new Set(fields.map((field) => field.key));
    for (const key of Object.keys(input)) {
      if (allowedKeys.has(key)) {
        continue;
      }

      //? Reject prototype-polluting own-keys unconditionally — even when an
      //? index signature (`[k: string]: …`) would otherwise admit them.
      if (PROTO_POLLUTION_KEYS.has(key)) {
        return { status: 'error', message: `${path}.${key} is not allowed` };
      }

      if (indexSignatures.length === 0) {
        return { status: 'error', message: `${path}.${key} is not allowed` };
      }

      const indexValue = input[key];
      let matched = false;
      for (const indexSignature of indexSignatures) {
        if (!matchesIndexKeyType({ keyType: indexSignature.keyType, key })) {
          continue;
        }

        const indexResult = validateType(indexSignature.type, indexValue, `${path}.${key}`, depth + 1);
        if (indexResult.status === 'success') {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return { status: 'error', message: `${path}.${key} is not allowed` };
      }
    }

    return { status: 'success' };
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*(?:<.+>)?$/.test(type)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*<.+>$/.test(type)) {
      return { status: 'error', message: `${path}: unresolved utility ${type}` };
    }

    return { status: 'error', message: `${path}: unresolved type ${type}` };
  }

  //? FAIL CLOSED. This terminal branch is reached only by a type string none of
  //? the recognizers above could structurally validate (tuples `[a, b]`,
  //? function types `() => void`, mapped/conditional/template-literal types, or
  //? an unresolved alias the generator left behind). Previously it returned
  //? `{ status: 'success' }`, silently passing ANY value for such a route — the
  //? only structural input gate became a no-op exactly where the type is
  //? unknown, enabling type-confusion / operator-smuggling. Rejecting here means
  //? an unmodelable route surfaces loudly: model the input explicitly, or set
  //? `validation: 'relaxed'` / `{ input: 'skip' }` on the route to opt out
  //? consciously (which short-circuits before this validator runs).
  return { status: 'error', message: `${path}: unvalidatable type ${type} — model it explicitly or set validation: 'relaxed' on the route` };
};

//? FAIL CLOSED on a parser throw. The hand-rolled `validateType` walks
//? attacker-controlled values; an unexpected shape that makes it throw must map
//? to a validation ERROR (rejected request), NEVER propagate up to the
//? api/sync handler as an uncaught throw — that would surface as a 500 and, on
//? some paths, bypass the input gate entirely (fail-open-to-crash).
const safeValidateType = (typeText: string, value: unknown, path: string): ValidationResult => {
  const [error, result] = tryCatchSync(() => validateType(typeText, value, path));
  if (error || !result) {
    return { status: 'error', message: `${path}: input validation failed` };
  }
  return result;
};

export const validateInputByType = async ({
  typeText,
  value,
  rootKey,
  filePath,
}: {
  typeText?: string;
  value: unknown;
  rootKey: string;
  filePath?: string;
}): Promise<ValidationResult> => {
  if (!typeText || typeText.trim() === '' || typeText.trim() === 'any') {
    return { status: 'success' };
  }

  //? CORE-01: production input-validation wiring. The legacy code returned
  //? `{ status: 'success' }` unconditionally in production, making the only
  //? structural input gate a no-op in prod (test/prod divergence + operator-
  //? injection exposure for handlers that trust `data` shape).
  //?
  //? The fix splits the two costs that used to be lumped together:
  //?   1. The DEEP type RESOLVER (`@luckystack/devkit`, TypeScript compiler API)
  //?      — dev-only, expensive, and `external` in the prod bundle. Still skipped
  //?      in prod (it would fail to import there anyway).
  //?   2. The structural VALIDATOR (`validateType`) — a pure, dependency-free
  //?      walk over the ALREADY-RESOLVED generated type text. This is cheap and
  //?      now runs in production too.
  //?
  //? In prod the generated `apiTypes` type text is already fully resolved at
  //? build time (the generator ran the devkit resolver before emitting), so we
  //? validate it directly without re-resolving. `validation.runtimeMode: 'off'`
  //? is the loud, documented opt-out that restores the old prod no-op.
  if (process.env.NODE_ENV === 'production') {
    //? Read the mode lazily (call-time) so `registerProjectConfig` can run after
    //? this module is imported. Indirect import avoids pulling projectConfig into
    //? the dev resolver path needlessly — but it's a cheap same-package import.
    const { getProjectConfig } = await import('./projectConfig');
    if (getProjectConfig().validation.runtimeMode === 'off') {
      return { status: 'success' };
    }
    //? Validate the pre-resolved generated type text directly. If the generator
    //? left an unresolved marker (`__RUNTIME_UNRESOLVED__::`), `validateType`
    //? surfaces it as an error rather than silently passing — that's the
    //? intended loud signal to regenerate artifacts before shipping.
    return safeValidateType(typeText, value, rootKey);
  }

  // Dev-only: the resolver uses TypeScript's compiler API for deep type
  // expansion. `@luckystack/devkit` is marked external in the prod esbuild
  // bundle (see scripts/bundleServer.mjs), so this branch compiles in prod but
  // cannot run (import would fail). That is fine — the production branch above
  // never reaches the devkit import.
  //
  // Indirect module ID (string variable, not literal) so tsc doesn't try to
  // type-resolve devkit at build time. Devkit depends on core, so a literal
  // type-resolved import would be a build-time circular dep.
  const devkitModuleId = '@luckystack/devkit';
  const devkit = (await import(devkitModuleId)) as DevkitTypeResolverModule;
  const resolvedType = devkit.resolveRuntimeTypeText({ typeText, filePath });
  if (resolvedType.status === 'error') {
    return { status: 'error', message: `${rootKey}: ${resolvedType.message}` };
  }

  return safeValidateType(resolvedType.typeText, value, rootKey);
};

interface DevkitTypeResolverModule {
  resolveRuntimeTypeText: (params: { typeText: string; filePath?: string }) =>
    | { status: 'success'; typeText: string }
    | { status: 'error'; message: string };
}
