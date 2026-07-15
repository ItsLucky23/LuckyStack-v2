import * as ts from 'typescript';
import path from 'node:path';
import { ROOT_DIR, getGeneratedSocketTypesPath } from '@luckystack/core';

let cachedProgram: ts.Program | null = null;

export const getServerProgram = (): ts.Program => {
  if (cachedProgram) return cachedProgram;

  const tsconfigPath = ts.findConfigFile(ROOT_DIR, ts.sys.fileExists.bind(ts.sys), 'tsconfig.server.json');
  if (!tsconfigPath) throw new Error('[TypeProgram] tsconfig.server.json not found');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- ts.readConfigFile returns { config: any }
  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile.bind(ts.sys));
  const { options, fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  cachedProgram = ts.createProgram(fileNames, options);
  return cachedProgram;
};

export const invalidateProgramCache = (): void => {
  cachedProgram = null;
};

//? Max nesting the inliner will expand before falling back to
//? `checker.typeToString`. 14 is MEASURED, not guessed: the decorator-based
//? MikroORM fixture (`__fixtures__/mikroEntities.ts` — BaseEntity + Collection +
//? a ManyToOne cycle, the deepest real-world graph we have) fully exhausts at
//? depth 14 with ZERO depth bailouts, in ~3ms and <2x the node count of 12
//? (2,491 -> 2,930). Raising it further changes nothing — a limit of 30 produces
//? an identical traversal — because it is the CYCLE guard (`stackTypeIds`), not
//? the depth limit, that bounds the walk. At the previous value of 12 the same
//? graph was truncated in 491 places, so entity-shaped payloads inlined as
//? `checker.typeToString` names rather than real structure. See
//? `tsProgram.test.ts` > 'DEPTH_LIMIT measurement'.
const DEPTH_LIMIT = 14;

export interface UnresolvedTypeSymbol {
  name: string;
  sourceFile?: string;
  importPath?: string;
}

export interface ExpandedTypeResult {
  text: string;
  unresolvedSymbols: UnresolvedTypeSymbol[];
}

const JSON_TYPE_NAMES = new Set([
  'Json',
  'JsonValue',
  'JsonObject',
  'JsonArray',
  'InputJsonValue',
  'InputJsonObject',
  'InputJsonArray',
]);

// Generic containers we never recursively expand (their internal shape is irrelevant to API types)
const SKIP_EXPANSION = new Set([
  'Promise', 'Map', 'WeakMap', 'Set', 'WeakSet',
  'Error', 'Date', 'RegExp', 'Buffer', 'ArrayBuffer', 'ReadonlyArray',
]);

const isJsonLikeType = (type: ts.Type, checker: ts.TypeChecker): boolean => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ts.Type.symbol is typed non-nullable but absent at runtime for primitive types
  const symbolName = type.symbol?.name ?? '';
  const aliasName = type.aliasSymbol?.name ?? '';

  if (JSON_TYPE_NAMES.has(symbolName) || JSON_TYPE_NAMES.has(aliasName)) return true;

  const rendered = checker.typeToString(type);
  return /(\bPrisma\.)?(Input)?Json(Value|Object|Array)\b/.test(rendered);
};

const getLiteralTypeFromExpression = (
  expression: ts.Expression,
  checker: ts.TypeChecker,
  depth: number,
): string | null => {
  if (ts.isParenthesizedExpression(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (expression.kind === ts.SyntaxKind.NullKeyword) return 'null';

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return `'${expression.text.replaceAll('\\', '\\\\').replaceAll('\'', String.raw`\'`)}'`;
  }

  if (ts.isNumericLiteral(expression)) {
    return expression.text;
  }

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    return `-${expression.operand.text}`;
  }

  if (ts.isIdentifier(expression)) {
    const identifierType = checker.getTypeAtLocation(expression);
    const isLiteralType = (identifierType.flags & (
      ts.TypeFlags.StringLiteral
      | ts.TypeFlags.NumberLiteral
      | ts.TypeFlags.BooleanLiteral
      | ts.TypeFlags.Null
      | ts.TypeFlags.Undefined
    )) !== 0;

    if (isLiteralType || identifierType.isUnion()) {
      const expanded = expandTypeDetailed(identifierType, checker, depth).text;
      if (expanded.includes("'") || /\btrue\b|\bfalse\b|\bnull\b|\bundefined\b/.test(expanded)) {
        return expanded;
      }
    }
  }

  return null;
};

const getLiteralTypeFromPropertySymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  depth: number,
): string | null => {
  const declarations = symbol.declarations ?? [];

  for (const declaration of declarations) {
    if (ts.isPropertyAssignment(declaration)) {
      const literal = getLiteralTypeFromExpression(declaration.initializer, checker, depth);
      if (literal) return literal;
    }

    if (ts.isShorthandPropertyAssignment(declaration)) {
      const literal = getLiteralTypeFromExpression(declaration.name, checker, depth);
      if (literal) return literal;
    }
  }

  return null;
};

const normalizeImportPath = (targetFilePath: string): string => {
  // Derive fromDir from the configured generated socket types path so
  // non-`src` srcDir layouts produce correct relative import paths.
  const fromDir = path.dirname(getGeneratedSocketTypesPath());
  const from = fromDir.replaceAll('\\', '/');
  const to = targetFilePath.replaceAll('\\', '/');

  const normalized = path.posix.relative(from, to).replaceAll('\\', '/');
  const withoutExtension = normalized.replace(/(\.d)?\.(ts|tsx|js|jsx)$/i, '');

  if (withoutExtension.startsWith('.')) return withoutExtension;
  return `./${withoutExtension}`;
};

const mergeUnresolvedSymbols = (
  left: UnresolvedTypeSymbol[],
  right: UnresolvedTypeSymbol[],
): UnresolvedTypeSymbol[] => {
  const merged = [...left];
  const seen = new Set(merged.map((symbol) => `${symbol.name}|${symbol.importPath ?? ''}|${symbol.sourceFile ?? ''}`));
  for (const symbol of right) {
    const key = `${symbol.name}|${symbol.importPath ?? ''}|${symbol.sourceFile ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(symbol);
  }
  return merged;
};

const collectTypeSymbolFallback = (type: ts.Type): UnresolvedTypeSymbol[] => {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return [];

  const name = symbol.getName();
  if (!name || name.startsWith('__')) return [];

  const declaration = symbol.declarations?.[0];
  if (!declaration) return [{ name }];

  const sourceFile = declaration.getSourceFile().fileName;
  if (!sourceFile || sourceFile.includes('/node_modules/') || sourceFile.includes('\\node_modules\\')) {
    return [{ name }];
  }

  return [{
    name,
    sourceFile,
    importPath: normalizeImportPath(sourceFile),
  }];
};

interface ExpandState {
  stackTypeIds: Set<number>;
  /**
   * Model what the CLIENT actually receives, not what the handler returns.
   *
   * Everything on an OUTPUT path crosses the wire as JSON — socket.io's default
   * parser is `JSON.stringify`, and the HTTP route does the same. JSON has no
   * `Date`: `Date.prototype.toJSON()` turns it into an ISO string. So emitting
   * `createdAt: Date` was a lie that TypeScript happily endorsed —
   * `user.createdAt.getTime()` compiled and then threw at runtime.
   *
   * OUTPUTS ONLY. Inputs must keep their true types: their text feeds
   * `validateInputByType`, which in production runs with no resolver and is
   * fail-closed, so projecting there would reject real payloads.
   */
  wireProjection: boolean;
}

//? Types whose JSON.stringify result differs from their TypeScript type. Keyed by
//? the constructor/symbol name, valued by what the client genuinely receives.
//? `Date` is the one that bites in practice — it has a `toJSON()` returning an
//? ISO string. Anything added here must be justified by what the SERIALIZER does,
//? not by what feels convenient.
const WIRE_PROJECTED_TYPES = new Map<string, string>([['Date', 'string']]);

export interface ExpandOptions {
  /**
   * Emit what the client RECEIVES (JSON) rather than what the handler returns.
   * Pass `true` for every OUTPUT type; never for an input (see `ExpandState`).
   */
  wireProjection?: boolean;
}

// Recursively expand a TypeScript type to an inline type string with no named references.
// The result is self-contained and requires no imports.
export const expandTypeDetailed = (
  type: ts.Type,
  checker: ts.TypeChecker,
  depth = 0,
  state?: ExpandState,
  options?: ExpandOptions,
): ExpandedTypeResult => {
  //? `state` carries the flag through the recursion, so a nested Date inside a
  //? returned object is projected too — not just a top-level one.
  const expandState: ExpandState =
    state ?? { stackTypeIds: new Set<number>(), wireProjection: options?.wireProjection ?? false };
  const typeId = (type as ts.Type & { id?: number }).id;

  if (typeId !== undefined) {
    if (expandState.stackTypeIds.has(typeId)) {
      return {
        text: checker.typeToString(type),
        unresolvedSymbols: collectTypeSymbolFallback(type),
      };
    }
    expandState.stackTypeIds.add(typeId);
  }

  try {
    if (depth > DEPTH_LIMIT) {
      return {
        text: checker.typeToString(type),
        unresolvedSymbols: collectTypeSymbolFallback(type),
      };
    }

    if (isJsonLikeType(type, checker)) return { text: 'JsonValue', unresolvedSymbols: [] };

    // String literals ('hello')  use single quotes for consistency with the codebase
    if (type.isStringLiteral()) return { text: `'${type.value.replaceAll('\\', '\\\\').replaceAll('\'', String.raw`\'`)}'`, unresolvedSymbols: [] };

    // Number literals (42, 3.14)
    if (type.isNumberLiteral()) return { text: String(type.value), unresolvedSymbols: [] };

  // Primitives and special types (string, number, boolean, true, false, null, undefined, any, unknown, never, void)
    if (
      type.flags
      & (
        ts.TypeFlags.String
        | ts.TypeFlags.Number
        | ts.TypeFlags.Boolean
        | ts.TypeFlags.BooleanLiteral
        | ts.TypeFlags.Undefined
        | ts.TypeFlags.Null
        | ts.TypeFlags.Any
        | ts.TypeFlags.Unknown
        | ts.TypeFlags.Never
        | ts.TypeFlags.Void
      )
    ) {
      return { text: checker.typeToString(type), unresolvedSymbols: [] };
    }

  // Union types (A | B | C)
    if (type.isUnion()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.types.map((innerType) => {
      const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      return expanded.text;
    });
    //? Dedupe members. The checker's union is distinct BEFORE projection, but two
    //? members can collapse to the same text after it — `Date | string` becomes
    //? `string | string`, which is valid TypeScript and ugly to read. Order is
    //? preserved (first occurrence wins) so unprojected output stays byte-identical.
    const uniqueTypes = [...new Set(expandedTypes)];
    return { text: uniqueTypes.join(' | '), unresolvedSymbols };
    }

  // Intersection types (A & B)
    if (type.isIntersection()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.types.map((innerType) => {
      const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      return expanded.text;
    });
    return { text: expandedTypes.join(' & '), unresolvedSymbols };
    }

  // Object types (interfaces, type literals, generic instances)
    if (type.flags & ts.TypeFlags.Object) {
    const objectType = type as ts.ObjectType;

    // Tuple types [A, B, C]
    //? A tuple VALUE is a TypeReference whose *target* carries ObjectFlags.Tuple
    //? — the instance does not. (The sole exception is the empty tuple `[]`,
    //? which has no type arguments to instantiate and so is its own target.)
    //? Testing only the instance, as this branch used to, therefore missed every
    //? non-empty tuple: it fell through to the Reference branch below, where a
    //? tuple target has no symbol (`targetName === ''`, so neither Array nor
    //? SKIP_EXPANSION matched), and on into the `type.symbol.name` read below —
    //? which threw, because a tuple reference has no symbol either. That crash
    //? is DEVKIT-1: MikroORM's `EntityProperty.embedded?: [string, string]` made
    //? every route returning an entity degrade to `{ status: string }`.
    const tupleTarget = (objectType.objectFlags & ts.ObjectFlags.Reference)
      ? ((objectType as ts.TypeReference).target as ts.ObjectType)
      : objectType;

    if (tupleTarget.objectFlags & ts.ObjectFlags.Tuple) {
      const typeArgs = checker.getTypeArguments(objectType as ts.TypeReference);
      let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
      const tupleTypes = typeArgs.map((innerType) => {
        const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
        return expanded.text;
      });
      return { text: `[${tupleTypes.join(', ')}]`, unresolvedSymbols };
    }

    if (objectType.objectFlags & ts.ObjectFlags.Reference) {
      const refType = objectType as ts.TypeReference;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ts.Type.symbol is typed non-nullable but absent at runtime for anonymous reference targets
      const targetName = refType.target.symbol?.name ?? '';

      // Array<T> / ReadonlyArray<T>  T[]
      if (targetName === 'Array' || targetName === 'ReadonlyArray') {
        const typeArgs = checker.getTypeArguments(refType);
        const firstArg = typeArgs[0];
        if (firstArg) {
          const expanded = expandTypeDetailed(firstArg, checker, depth + 1, expandState);
          const elementType = /\s[|&]\s/.test(expanded.text)
            ? `(${expanded.text})`
            : expanded.text;
          return {
            text: `${elementType}[]`,
            unresolvedSymbols: expanded.unresolvedSymbols,
          };
        }
      }

      // Known opaque containers  return as-is without expanding internals
      if (SKIP_EXPANSION.has(targetName)) {
        const projected = expandState.wireProjection ? WIRE_PROJECTED_TYPES.get(targetName) : undefined;
        return { text: projected ?? checker.typeToString(type), unresolvedSymbols: [] };
      }
    }

    // Known non-generic opaque containers (Date, Error, Buffer, etc.)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ts.Type.symbol is typed non-nullable but absent at runtime for synthesized object types (tuple references); same guard as the reads above
    const symbolName = type.symbol?.name || (type.aliasSymbol?.name ?? '');
    if (SKIP_EXPANSION.has(symbolName)) {
      const projected = expandState.wireProjection ? WIRE_PROJECTED_TYPES.get(symbolName) : undefined;
      return { text: projected ?? checker.typeToString(type), unresolvedSymbols: [] };
    }

    const props = checker.getPropertiesOfType(type);
    const indexInfos = checker.getIndexInfosOfType(type);

    if (props.length > 0 || indexInfos.length > 0) {
      const fields: string[] = [];
      let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

      for (const prop of props) {
        //? DEVKIT-1: skip symbol-keyed members. A property whose key is a
        //? unique symbol (e.g. MikroORM's `[OptionalProps]` / `[loadedType]` /
        //? `[selectedType]`) has an escaped name of the form `__@<name>@<id>`,
        //? which `checker.typeToString` would emit verbatim — an invalid TS
        //? identifier that corrupts the generated file. These markers carry no
        //? API-payload meaning, so drop them from the inlined type text.
        if (prop.getName().startsWith('__@')) continue;
        const propType = checker.getTypeOfSymbol(prop);
        const literalType = getLiteralTypeFromPropertySymbol(prop, checker, depth + 1);
        const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

        if (literalType) {
          fields.push(`${prop.name}${isOptional ? '?' : ''}: ${literalType}`);
          continue;
        }

        const expandedProp = expandTypeDetailed(propType, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expandedProp.unresolvedSymbols);
        fields.push(`${prop.name}${isOptional ? '?' : ''}: ${expandedProp.text}`);
      }

      for (const indexInfo of indexInfos) {
        const keyType = expandTypeDetailed(indexInfo.keyType, checker, depth + 1, expandState);
        const valueType = expandTypeDetailed(indexInfo.type, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, keyType.unresolvedSymbols);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, valueType.unresolvedSymbols);
        fields.push(`[key: ${keyType.text}]: ${valueType.text}`);
      }

      const indent = '  '.repeat(depth + 1);
      const outerIndent = '  '.repeat(depth);
      return {
        text: `{\n${indent}${fields.join(`;\n${indent}`)}\n${outerIndent}}`,
        unresolvedSymbols,
      };
    }

      return { text: '{ }', unresolvedSymbols: [] };
    }

    return {
      text: checker.typeToString(type),
      unresolvedSymbols: collectTypeSymbolFallback(type),
    };
  } finally {
    if (typeId !== undefined) {
      expandState.stackTypeIds.delete(typeId);
    }
  }
};

export const expandType = (type: ts.Type, checker: ts.TypeChecker, depth = 0): string => {
  return expandTypeDetailed(type, checker, depth).text;
};

