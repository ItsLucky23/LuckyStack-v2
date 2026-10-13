import path from 'node:path';
import {
  ObjectFlags,
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript-7-api/sync';
import { SyntaxKind, type Expression } from 'typescript-7-api/ast';
import {
  isAsExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeAssertion,
} from 'typescript-7-api/ast/is';
import { getGeneratedSocketTypesPath } from '@luckystack/core';

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

//? Socket.io sends these as binary attachments, while the HTTP transport runs
//? JSON.stringify (Buffer.toJSON(), `{}` for several browser binary objects).
//? A single shared API/sync output map cannot truthfully describe both. Refuse
//? the ambiguous contract and require an explicit wire DTO/base64 string.
const TRANSPORT_DEPENDENT_BINARY_TYPES = new Set([
  'Buffer', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Blob', 'File',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
]);

export class UnsupportedWireTypeError extends Error {
  constructor(typeName: string) {
    super(`[TypeMapGenerator] ${typeName} has transport-dependent or non-JSON output semantics. Return an explicit JSON DTO/base64 string, or use a transport-specific custom route.`);
    this.name = 'UnsupportedWireTypeError';
  }
}

const isJsonLikeType = (type: Type, checker: Checker): boolean => {
  const symbolName = type.getSymbol()?.name ?? '';
  const aliasName = type.getAliasSymbol()?.name ?? '';

  if (JSON_TYPE_NAMES.has(symbolName) || JSON_TYPE_NAMES.has(aliasName)) return true;

  //? Exact match only. A Prisma model OBJECT may contain a property rendered as
  //? `preferences: JsonValue`; substring matching would then collapse the whole
  //? model (and every nested relation) to `JsonValue` instead of projecting only
  //? that property.
  const rendered = checker.typeToString(type).trim();
  return /^(?:Prisma\.)?(?:Input)?Json(?:Value|Object|Array)$/.test(rendered);
};

const getLiteralTypeFromExpression = (
  expression: Expression,
  checker: Checker,
  depth: number,
): string | null => {
  if (isParenthesizedExpression(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (isAsExpression(expression) || isTypeAssertion(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (expression.kind === SyntaxKind.TrueKeyword) return 'true';
  if (expression.kind === SyntaxKind.FalseKeyword) return 'false';
  if (expression.kind === SyntaxKind.NullKeyword) return 'null';

  if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
    return `'${expression.text.replaceAll('\\', '\\\\').replaceAll('\'', String.raw`\'`)}'`;
  }

  if (isNumericLiteral(expression)) {
    return expression.text;
  }

  if (
    isPrefixUnaryExpression(expression)
    && expression.operator === SyntaxKind.MinusToken
    && isNumericLiteral(expression.operand)
  ) {
    return `-${expression.operand.text}`;
  }

  if (isIdentifier(expression)) {
    const identifierType = checker.getTypeAtLocation(expression);
    const isLiteralType = (identifierType.flags & (
      TypeFlags.StringLiteral
      | TypeFlags.NumberLiteral
      | TypeFlags.BooleanLiteral
      | TypeFlags.Null
      | TypeFlags.Undefined
    )) !== 0;

    if (isLiteralType || identifierType.isUnionType()) {
      const expanded = expandTypeDetailed(identifierType, checker, depth).text;
      if (expanded.includes("'") || /\btrue\b|\bfalse\b|\bnull\b|\bundefined\b/.test(expanded)) {
        return expanded;
      }
    }
  }

  return null;
};

const getLiteralTypeFromPropertySymbol = (
  symbol: TsSymbol,
  checker: Checker,
  depth: number,
): string | null => {
  for (const handle of symbol.declarations) {
    //? Declarations arrive as handles; resolving one fetches its file from the
    //? compiler, so only resolve the two kinds that can carry a literal.
    if (handle.kind !== SyntaxKind.PropertyAssignment && handle.kind !== SyntaxKind.ShorthandPropertyAssignment) continue;
    const declaration = handle.resolve();
    if (!declaration) continue;

    if (isPropertyAssignment(declaration)) {
      const literal = getLiteralTypeFromExpression(declaration.initializer, checker, depth);
      if (literal) return literal;
    }

    if (isShorthandPropertyAssignment(declaration) && isIdentifier(declaration.name)) {
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

const isNodeModulesPath = (filePath: string): boolean =>
  filePath.includes('/node_modules/') || filePath.includes('\\node_modules\\');

//? The real file name of a symbol's first declaration, or undefined for one in
//? node_modules (which includes TypeScript's own lib files). The handle's path is
//? the compiler's canonical key — enough to rule out node_modules without
//? fetching a large .d.ts — while only the resolved node carries the file name
//? exactly as written, which the generated import path is built from.
export const getDeclarationFileName = (symbol: TsSymbol): string | undefined => {
  const handle = symbol.declarations[0];
  if (!handle || isNodeModulesPath(handle.path)) return undefined;
  const fileName = handle.resolve()?.getSourceFile().fileName;
  return fileName && !isNodeModulesPath(fileName) ? fileName : undefined;
};

const collectTypeSymbolFallback = (type: Type): UnresolvedTypeSymbol[] => {
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  if (!symbol) return [];

  const name = symbol.name;
  if (!name || name.startsWith('__')) return [];

  const sourceFile = getDeclarationFileName(symbol);
  if (!sourceFile) return [{ name }];

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
   * OUTPUTS ONLY. Wire-safe inputs stay unprojected because their text feeds
   * `validateInputByType`, which is fail-closed. `extractors.ts` separately
   * rejects Date input annotations: JSON cannot deliver the promised instance.
   */
  wireProjection: boolean;
}

//? @adr 0029 — shared API/sync maps accept only JSON-stable contracts.
//? Types whose JSON.stringify result differs from their TypeScript type. Keyed by
//? the constructor/symbol name, valued by what the client genuinely receives.
//? `Date` is the one that bites in practice — it has a `toJSON()` returning an
//? ISO string. Anything added here must be justified by what the SERIALIZER does,
//? not by what feels convenient.
//?
//? This map is only a FAST PATH for types the expander already short-circuits via
//? SKIP_EXPANSION. The general rule is `resolveToJsonReturnType` below, which
//? needs no per-type entry — and no per-ORM entry, which is the point: a name list
//? would rot the moment MikroORM renames an internal or a consumer brings their
//? own ORM.
const WIRE_PROJECTED_TYPES = new Map<string, string>([['Date', 'string']]);

//? RULE 1 of the wire projection: if a type declares `toJSON()`, JSON.stringify
//? calls it and serializes THAT instead. So the client receives the return type,
//? not the declared one. This is the whole reason `Date` becomes a string — and
//? for free it also covers MikroORM's `Collection` (`toJSON(): EntityDTO<T>[]`),
//? Prisma's `Decimal`, and anything else that plays by JSON's contract.
//? Measured, not assumed: on a real entity, `createdAt: Date -> toJSON(): string`
//? and `items: Collection<Item> -> toJSON(): EntityDTO<TT>[]`.
//?
//? KNOWN LIMITATION — `items: ({ } & { })[]`, and why it stays that way.
//? A GENERIC toJSON leaves its type parameter uninstantiated here. MikroORM's is
//? `Collection<T>.toJSON<TT extends T>(): EntityDTO<TT>[]`, so `getReturnType()`
//? hands back `EntityDTO<TT>[]` with TT still a bare type parameter (its
//? constraint resolves to the real entity, the parameter itself does not).
//? `EntityDTO<TT>` is an intersection of two homomorphic mapped types keyed on
//? `keyof TT`; over an unresolved TT both are deferred and expose ZERO
//? properties, so each renders `{ }` and the pair renders `{ } & { }`.
//?
//? Instantiating TT would fix it and would NOT be expensive — a real
//? `EntityDTO<FixtureItem>` expands to 166 clean chars, 0 unresolved symbols.
//? It is simply not reachable: TS exposes no way to instantiate a generic call
//? signature. `getSignatureInstantiation` / `instantiateType` are absent from the
//? public API AND from all 174 runtime methods on the checker (verified, TS
//? 6.0.3). `getApparentType` does not resolve it; the base class's non-generic
//? `ArrayCollection.toJSON(): EntityDTO<T>[]` is no better, because `getBaseTypes`
//? returns the UNINSTANTIATED `ArrayCollection<T, O>`.
//?
//? The one route that LOOKS open — substitute TT with its constraint and expand
//? that — is a guess, not a derivation: it equates `EntityDTO<TT>` with "TT
//? serialized", which is nowhere in the contract, and only approximates MikroORM
//? by luck. An ORM whose `toJSON<T>()` returns a shape unrelated to T would get a
//? confidently fabricated type. A name-free rule that is really a per-ORM guess is
//? still a per-ORM guess, so it fails the same bar that keeps this projection free
//? of ORM name lists.
//?
//? AND THE VAGUENESS IS LOAD-BEARING — it is not merely tolerable. Measured at
//? RUNTIME (MikroORM 6.6.14, live EntityManager, real entity with two children),
//? a Collection has TWO serializations and they do not agree:
//?
//?   JSON.stringify(owner)       -> {"items":["i1","i2"],"name":"Ada","id":"o1"}
//?                                  ^ items are PRIMARY KEYS (string[])
//?   JSON.stringify(owner.items) -> [{"label":"first",...},{"label":"second",...}]
//?                                  ^ items are OBJECTS
//?
//? RULE 1 reads `Collection.toJSON()` and so models the SECOND. But a handler
//? returning the ENTITY takes the first: MikroORM's parent serializer emits keys
//? for the collection property and never calls `Collection.toJSON()` at all. So
//? rule 1's premise ("stringify calls toJSON on this property") is simply false
//? for a Collection reached THROUGH an entity — the normal case.
//?
//? Which means an instantiated TT would emit `items: EntityDTO<Item>[]` — objects
//? with `.label` — while the wire carries `["i1","i2"]`. `items[0].label` would
//? compile and be `undefined` at runtime: precise-looking and false, the exact lie
//? this projection exists to kill. `{ }` accepts a string, so `({ } & { })[]` is
//? instead a TRUE (if useless) statement about that payload. TS's inability to
//? instantiate TT is accidentally protecting us from rule 1's wrong premise here.
//?
//? So: vague-but-true beats precise-but-false. The cost is one narrowing step for
//? the consumer; it never lies to them, which is the bar that matters. Anyone
//? tempted to make this precise must first fix the premise above — and that needs
//? per-ORM serializer knowledge, which is the thing we refuse to encode.
//?
//? (Rule 1 is right for `Date`: `createdAt` is verified to come back as an ISO
//? string on the same measured payload, both standalone and through the entity.)
const resolveToJsonReturnType = (type: Type, checker: Checker): Type | null => {
  const toJson = type.getProperty('toJSON');
  if (!toJson) return null;
  if (!toJson.valueDeclaration && toJson.declarations.length === 0) return null;
  //? The type of a symbol AT its own declaration is its non-missing type; asking
  //? for that directly avoids fetching the declaring file (often a lib .d.ts).
  const signature = checker.getNonMissingTypeOfSymbol(toJson).getCallSignatures()[0];
  return signature ? signature.getReturnType() : null;
};

//? RULE 2: every function-valued property is omitted by JSON.stringify — even a
//? callable object with attached enumerable data. Arrays turn the same value into
//? `null`. The old zero-properties condition was false: JSON never serializes a
//? function object's attached properties when the VALUE itself is callable.
const isFunctionValueType = (type: Type): boolean => type.getCallSignatures().length > 0;

const typeNameOf = (type: Type, checker: Checker): string => {
  if (type.isTypeReference()) {
    const targetName = type.getTarget().getSymbol()?.name;
    if (targetName) return targetName;
  }
  return type.getSymbol()?.name ?? checker.typeToString(type);
};

const assertSupportedWireType = (type: Type, checker: Checker): void => {
  const typeName = typeNameOf(type, checker);
  if (TRANSPORT_DEPENDENT_BINARY_TYPES.has(typeName)) {
    throw new UnsupportedWireTypeError(typeName);
  }
  if ((type.flags & (TypeFlags.BigInt | TypeFlags.BigIntLiteral)) !== 0) {
    throw new UnsupportedWireTypeError('bigint');
  }
};

const isJsonOmittedValueType = (type: Type): boolean =>
  (type.flags & (
    TypeFlags.Undefined
    | TypeFlags.Void
    | TypeFlags.ESSymbol
    | TypeFlags.UniqueESSymbol
  )) !== 0 || isFunctionValueType(type);

interface WireConstituents {
  serializable: Type[];
  omitted: boolean;
}

//? Resolve one property/array-element type to the values JSON can actually
//? carry. `undefined`/symbol/function constituents disappear from objects and
//? become null in arrays; toJSON return types replace their declared type.
const resolveWireConstituents = (type: Type, checker: Checker): WireConstituents => {
  const queue = type.isUnionType() ? [...type.getTypes()] : [type];
  const serializable: Type[] = [];
  let omitted = false;
  let changed = false;

  for (const candidate of queue) {
    assertSupportedWireType(candidate, checker);
    if (isJsonOmittedValueType(candidate)) {
      omitted = true;
      changed = true;
      continue;
    }

    const jsonType = resolveToJsonReturnType(candidate, checker);
    const effective = jsonType && jsonType.id !== candidate.id ? jsonType : candidate;
    if (effective !== candidate) changed = true;
    const effectiveTypes = effective.isUnionType() ? effective.getTypes() : [effective];
    for (const effectiveType of effectiveTypes) {
      assertSupportedWireType(effectiveType, checker);
      if (isJsonOmittedValueType(effectiveType)) {
        omitted = true;
        changed = true;
      } else {
        serializable.push(effectiveType);
      }
    }
  }

  //? Preserve the original Type object when JSON does not change it. TypeScript
  //? represents `boolean` as an internal `false | true` union and JsonValue as a
  //? recursive union; expanding those constituents separately would degrade the
  //? stable `boolean` / `JsonValue` text for no wire-level reason.
  return changed ? { serializable, omitted } : { serializable: [type], omitted: false };
};

export interface ExpandOptions {
  /**
   * Emit what the client RECEIVES rather than what the handler returns.
   * Pass `true` for every OUTPUT type; never for an input (see `ExpandState`).
   */
  wireProjection?: boolean;
}

// Recursively expand a TypeScript type to an inline type string with no named references.
// The result is self-contained and requires no imports.
export const expandTypeDetailed = (
  type: Type,
  checker: Checker,
  depth = 0,
  state?: ExpandState,
  options?: ExpandOptions,
): ExpandedTypeResult => {
  //? `state` carries the flag through the recursion, so a nested Date inside a
  //? returned object is projected too — not just a top-level one.
  const expandState: ExpandState =
    state ?? { stackTypeIds: new Set<number>(), wireProjection: options?.wireProjection ?? false };
  const typeId = type.id;

  if (expandState.stackTypeIds.has(typeId)) {
    return {
      text: checker.typeToString(type),
      unresolvedSymbols: collectTypeSymbolFallback(type),
    };
  }
  expandState.stackTypeIds.add(typeId);

  try {
    if (expandState.wireProjection) {
      assertSupportedWireType(type, checker);
      //? Object-property and array branches below handle omission/null with the
      //? surrounding context. Reaching an omitted value directly means the
      //? whole response/stream payload has no JSON representation.
      if (isJsonOmittedValueType(type)) {
        throw new UnsupportedWireTypeError(checker.typeToString(type));
      }
    }

    if (depth > DEPTH_LIMIT) {
      return {
        text: checker.typeToString(type),
        unresolvedSymbols: collectTypeSymbolFallback(type),
      };
    }

    if (isJsonLikeType(type, checker)) return { text: 'JsonValue', unresolvedSymbols: [] };

    // String literals ('hello')  use single quotes for consistency with the codebase
    if (type.isStringLiteralType()) return { text: `'${type.value.replaceAll('\\', '\\\\').replaceAll('\'', String.raw`\'`)}'`, unresolvedSymbols: [] };

    // Number literals (42, 3.14)
    if (type.isNumberLiteralType()) return { text: String(type.value), unresolvedSymbols: [] };

  // Primitives and special types (string, number, boolean, true, false, null, undefined, any, unknown, never, void)
    if (
      type.flags
      & (
        TypeFlags.String
        | TypeFlags.Number
        | TypeFlags.Boolean
        | TypeFlags.BooleanLiteral
        | TypeFlags.Undefined
        | TypeFlags.Null
        | TypeFlags.Any
        | TypeFlags.Unknown
        | TypeFlags.Never
        | TypeFlags.Void
      )
    ) {
      return { text: checker.typeToString(type), unresolvedSymbols: [] };
    }

  // Union types (A | B | C)
    if (type.isUnionType()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.getTypes().map((innerType) => {
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
    if (type.isIntersectionType()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.getTypes().map((innerType) => {
      const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      return expanded.text;
    });
    return { text: expandedTypes.join(' & '), unresolvedSymbols };
    }

  // Object types (interfaces, type literals, generic instances)
    if (type.isObjectType()) {
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
    const tupleTarget = type.isTypeReference() ? type.getTarget() : type;

    if (tupleTarget.objectFlags & ObjectFlags.Tuple) {
      const typeArgs = type.isTypeReference() ? checker.getTypeArguments(type) : [];
      let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
      const tupleTypes = typeArgs.map((innerType) => {
        const wire = expandState.wireProjection
          ? resolveWireConstituents(innerType, checker)
          : { serializable: [innerType], omitted: false };
        const texts: string[] = [];
        for (const serializableType of wire.serializable) {
          const expanded = expandTypeDetailed(serializableType, checker, depth + 1, expandState);
          unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
          texts.push(expanded.text);
        }
        //? JSON.stringify turns an omitted tuple/array slot into null.
        if (wire.omitted) texts.push('null');
        return [...new Set(texts)].join(' | ');
      });
      return { text: `[${tupleTypes.join(', ')}]`, unresolvedSymbols };
    }

    //? Wire projection, rule 1 — BEFORE any structural expansion. If the type
    //? declares toJSON(), that return value IS what the client receives, so
    //? expanding the declared shape would describe something nobody ever sees.
    //? Guarded on `wireProjection` so inputs are untouched (their text feeds the
    //? fail-closed prod validator).
    if (expandState.wireProjection) {
      //? Binary types were rejected above before their HTTP-only toJSON shape
      //? could hide the Socket.io binary representation.
      const jsonType = resolveToJsonReturnType(type, checker);
      //? Identity check: a type whose toJSON returns itself (or a self-referential
      //? DTO) would recurse forever. The stack guard would catch it, but bailing
      //? here keeps the output structural instead of a typeToString fallback.
      if (jsonType && jsonType.id !== type.id) {
        return expandTypeDetailed(jsonType, checker, depth + 1, expandState);
      }
    }

    if (type.isTypeReference()) {
      const targetName = type.getTarget().getSymbol()?.name ?? '';

      // Array<T> / ReadonlyArray<T>  T[]
      if (targetName === 'Array' || targetName === 'ReadonlyArray') {
        const typeArgs = checker.getTypeArguments(type);
        const firstArg = typeArgs[0];
        if (firstArg) {
          const wire = expandState.wireProjection
            ? resolveWireConstituents(firstArg, checker)
            : { serializable: [firstArg], omitted: false };
          let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
          const texts: string[] = [];
          for (const serializableType of wire.serializable) {
            const expanded = expandTypeDetailed(serializableType, checker, depth + 1, expandState);
            unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
            texts.push(expanded.text);
          }
          //? In arrays JSON.stringify substitutes null instead of deleting a slot.
          if (wire.omitted) texts.push('null');
          const expandedText = [...new Set(texts)].join(' | ');
          const elementType = /\s[|&]\s/.test(expandedText)
            ? `(${expandedText})`
            : expandedText;
          return { text: `${elementType}[]`, unresolvedSymbols };
        }
      }

      // Known opaque containers  return as-is without expanding internals
      if (SKIP_EXPANSION.has(targetName)) {
        const projected = expandState.wireProjection ? WIRE_PROJECTED_TYPES.get(targetName) : undefined;
        return { text: projected ?? checker.typeToString(type), unresolvedSymbols: [] };
      }
    }

    // Known non-generic opaque containers (Date, Error, Buffer, etc.)
    const symbolName = (type.getSymbol()?.name ?? '') || (type.getAliasSymbol()?.name ?? '');
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
        if (prop.name.startsWith('__@')) continue;
        const propType = checker.getTypeOfSymbol(prop);
        const wire = expandState.wireProjection
          ? resolveWireConstituents(propType, checker)
          : { serializable: [propType], omitted: false };

        //? A property that can only be undefined/symbol/function never appears.
        if (wire.serializable.length === 0) continue;

        const literalType = getLiteralTypeFromPropertySymbol(prop, checker, depth + 1);
        const isOptional = (prop.flags & SymbolFlags.Optional) !== 0 || wire.omitted;

        //? Literal preservation is valid when projection did not remove a
        //? constituent (e.g. `string | undefined` must become optional). The
        //? checker often exposes `true` as `boolean` (`false | true`), so do not
        //? require one constituent here or discriminated response unions collapse.
        if (literalType && !wire.omitted) {
          fields.push(`${prop.name}${isOptional ? '?' : ''}: ${literalType}`);
          continue;
        }

        const texts: string[] = [];
        for (const serializableType of wire.serializable) {
          const expandedProp = expandTypeDetailed(serializableType, checker, depth + 1, expandState);
          unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expandedProp.unresolvedSymbols);
          texts.push(expandedProp.text);
        }
        fields.push(`${prop.name}${isOptional ? '?' : ''}: ${[...new Set(texts)].join(' | ')}`);
      }

      for (const indexInfo of indexInfos) {
        const keyType = expandTypeDetailed(indexInfo.keyType, checker, depth + 1, expandState);
        const wire = expandState.wireProjection
          ? resolveWireConstituents(indexInfo.valueType, checker)
          : { serializable: [indexInfo.valueType], omitted: false };
        //? An index whose values are always omitted serializes as an empty object.
        if (wire.serializable.length === 0) continue;
        const valueTexts: string[] = [];
        for (const serializableType of wire.serializable) {
          const valueType = expandTypeDetailed(serializableType, checker, depth + 1, expandState);
          unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, valueType.unresolvedSymbols);
          valueTexts.push(valueType.text);
        }
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, keyType.unresolvedSymbols);
        fields.push(`[key: ${keyType.text}]: ${[...new Set(valueTexts)].join(' | ')}`);
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
    expandState.stackTypeIds.delete(typeId);
  }
};

export const expandType = (type: Type, checker: Checker, depth = 0): string => {
  return expandTypeDetailed(type, checker, depth).text;
};

