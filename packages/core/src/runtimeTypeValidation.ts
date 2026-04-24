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
            type: fieldMatch[4].trim(),
          });
        } else {
          const indexMatch = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\]\s*:\s*([\s\S]+)$/.exec(trimmed);
          if (indexMatch) {
            indexSignatures.push({
              keyName: indexMatch[1].trim(),
              keyType: indexMatch[2].trim(),
              type: indexMatch[3].trim(),
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
        type: fieldMatch[4].trim(),
      });
    } else {
      const indexMatch = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\]\s*:\s*([\s\S]+)$/.exec(final);
      if (indexMatch) {
        indexSignatures.push({
          keyName: indexMatch[1].trim(),
          keyType: indexMatch[2].trim(),
          type: indexMatch[3].trim(),
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

const validateType = (typeText: string, value: unknown, path: string): ValidationResult => {
  const type = typeText.trim();

  if (type.startsWith('__RUNTIME_UNRESOLVED__::')) {
    const unresolvedMessage = type.replace('__RUNTIME_UNRESOLVED__::', '').trim();
    return { status: 'error', message: `${path}: ${unresolvedMessage}` };
  }

  if (type.startsWith('(') && type.endsWith(')')) {
    return validateType(type.slice(1, -1), value, path);
  }

  if (type.includes('|')) {
    const unionParts = splitTopLevel(type, '|').filter(Boolean);
    if (unionParts.length > 1) {
      for (const unionType of unionParts) {
        const result = validateType(unionType, value, path);
        if (result.status === 'success') return result;
      }
      return { status: 'error', message: `${path} does not match union type ${type}` };
    }
  }

  if (type.includes('&')) {
    const intersectionParts = splitTopLevel(type, '&').filter(Boolean);
    if (intersectionParts.length > 1) {
      for (const intersectionType of intersectionParts) {
        const result = validateType(intersectionType, value, path);
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
    if (itemType === type) {
      return { status: 'success' };
    }
    for (const [index, element] of value.entries()) {
      const result = validateType(itemType, element, `${path}[${String(index)}]`);
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
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { status: 'success' };
    }
    return { status: 'error', message: `${path} should be an object` };
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

      const result = validateType(field.type, fieldValue, `${path}.${field.key}`);
      if (result.status === 'error') return result;
    }

    const allowedKeys = new Set(fields.map((field) => field.key));
    for (const key of Object.keys(input)) {
      if (allowedKeys.has(key)) {
        continue;
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

        const indexResult = validateType(indexSignature.type, indexValue, `${path}.${key}`);
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

  return { status: 'success' };
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

  // Runtime type expansion relies on TypeScript internals and is intended for development.
  // In production we skip this expensive validation to avoid loading dev-only compiler code.
  if (process.env.NODE_ENV === 'production') {
    return { status: 'success' };
  }

  // Dev-only: the resolver uses TypeScript's compiler API for deep type
  // expansion. `@luckystack/devkit` is marked external in the prod esbuild
  // bundle (see scripts/bundleServer.mjs), so this branch compiles in prod but
  // cannot run (import would fail). That is fine — the `NODE_ENV !== 'production'`
  // guard above means the import is never reached in prod.
  const {
    resolveRuntimeTypeText,
  } = await import('@luckystack/devkit');

  const resolvedType = resolveRuntimeTypeText({ typeText, filePath });
  if (resolvedType.status === 'error') {
    return { status: 'error', message: `${rootKey}: ${resolvedType.message}` };
  }

  return validateType(resolvedType.typeText, value, rootKey);
};
