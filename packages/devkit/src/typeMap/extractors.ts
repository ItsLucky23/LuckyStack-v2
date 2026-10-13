import path from 'node:path';
import { SymbolFlags, type Checker, type Type } from 'typescript-7-api/sync';
import {
  ScriptKind,
  type FunctionLikeDeclaration,
  type InterfaceDeclaration,
  type Node,
  type SourceFile,
} from 'typescript-7-api/ast';
import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isInterfaceDeclaration,
  isObjectLiteralExpression,
  isPropertySignatureDeclaration,
  isReturnStatement,
  isTypeReferenceNode,
  isVariableStatement,
} from 'typescript-7-api/ast/is';
import {
  expandTypeDetailed,
  ExpandedTypeResult,
  getDeclarationFileName,
  UnresolvedTypeSymbol,
  UnsupportedWireTypeError,
} from './tsProgram';
import { getServerProgram, parseSourceText } from './tsApi';
import { recordExtractionOutcome } from './extractionDiagnostics';
import { getGeneratedSocketTypesPath } from '@luckystack/core';

export type TypeExtractionResult = ExpandedTypeResult;

const TYPE_NAME_PATTERN = /\b[A-Z][A-Za-z0-9_]*\b/g;

const KNOWN_GLOBAL_TYPE_NAMES = new Set([
  'String', 'Number', 'Boolean', 'Object', 'Array', 'ReadonlyArray', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'RegExp', 'Error', 'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Awaited', 'JsonValue', 'JsonObject', 'JsonArray', 'JsonPrimitive',
]);

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

const collectFallbackSymbolsFromTypeText = (
  typeText: string,
  scopeNode: Node,
  checker: Checker,
): UnresolvedTypeSymbol[] => {
  const names = new Set((typeText.match(TYPE_NAME_PATTERN) ?? []).filter((name) => !KNOWN_GLOBAL_TYPE_NAMES.has(name)));
  const symbolsInScope = checker.getSymbolsInScope(
    scopeNode,
    SymbolFlags.TypeAlias | SymbolFlags.Interface | SymbolFlags.Class | SymbolFlags.Enum | SymbolFlags.Alias,
  );

  const unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  for (const name of names) {
    const localSymbol = symbolsInScope.find((symbol) => symbol.name === name);
    if (!localSymbol) continue;

    const targetSymbol = (localSymbol.flags & SymbolFlags.Alias) === 0
      ? localSymbol
      : checker.getAliasedSymbol(localSymbol);

    if (targetSymbol.declarations.length === 0) {
      unresolvedSymbols.push({ name });
      continue;
    }

    const sourceFile = getDeclarationFileName(targetSymbol);
    if (!sourceFile) continue;

    unresolvedSymbols.push({
      name,
      sourceFile,
      importPath: normalizeImportPath(sourceFile),
    });
  }

  return unresolvedSymbols;
};

//  shared helpers

// Finds a top-level interface declaration by name in a source file's statements.
const findInterface = (sourceFile: SourceFile, name: string): InterfaceDeclaration | null => {
  for (const stmt of sourceFile.statements) {
    if (isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt;
  }
  return null;
};

// Reads the type of a named property inside an interface declaration.
const getInterfacePropertyType = (
  iface: InterfaceDeclaration,
  propertyName: string,
  checker: Checker,
): Type | null => {
  for (const member of iface.members) {
    if (
      isPropertySignatureDeclaration(member)
      && isIdentifier(member.name)
      && member.name.text === propertyName
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TS 7.1 declares PropertySignature.type required, but it is undefined for `{ a; }`
      && member.type
    ) {
      return checker.getTypeFromTypeNode(member.type);
    }
  }
  return null;
};

// Finds the function-like initializer of `const main = ...` in a source file.
const findMainFunction = (sourceFile: SourceFile): FunctionLikeDeclaration | null => {
  for (const stmt of sourceFile.statements) {
    if (isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          isIdentifier(decl.name)
          && decl.name.text === 'main'
          && decl.initializer
          && (isArrowFunction(decl.initializer) || isFunctionExpression(decl.initializer))
        ) {
          return decl.initializer;
        }
      }
    }

    if (isFunctionDeclaration(stmt) && stmt.name?.text === 'main') {
      return stmt;
    }
  }
  return null;
};

// Collects the expanded type strings of all object-literal return statements
// in a function body, without descending into nested function definitions.
const collectReturnObjectTypeDetails = (
  funcNode: FunctionLikeDeclaration,
  checker: Checker,
): TypeExtractionResult => {
  const types: string[] = [];
  let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  const visit = (node: Node): void => {
    if (isReturnStatement(node) && node.expression && isObjectLiteralExpression(node.expression)) {
      const type = checker.getTypeAtLocation(node.expression);
      //? OUTPUT — project to the wire shape. What a handler returns is not what
      //? the client gets: it crosses as JSON, so a Date arrives as an ISO string.
      const expanded = expandTypeDetailed(type, checker, 0, undefined, { wireProjection: true });
      types.push(expanded.text);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      unresolvedSymbols = mergeUnresolvedSymbols(
        unresolvedSymbols,
        collectFallbackSymbolsFromTypeText(expanded.text, node.expression, checker),
      );
    }

    // Recurse into control flow but not into nested function bodies
    if (
      !isArrowFunction(node)
      && !isFunctionExpression(node)
      && !isFunctionDeclaration(node)
    ) {
      node.forEachChild(visit);
    }
  };

  funcNode.forEachChild(visit);
  return { text: unionTypes(types), unresolvedSymbols };
};

// Collects the expanded payload type strings of stream(...) /
// broadcastStream(...) / streamTo(tokens, ...) calls in a function body,
// without descending into nested function definitions.
//
// `stream` and `broadcastStream` take the payload as the FIRST argument.
// `streamTo` takes `(tokens, payload)` so the payload is the SECOND argument.
const STREAM_EMIT_NAMES = new Set(['stream', 'broadcastStream', 'streamTo']);

const collectStreamCallPayloadTypeDetails = (
  funcNode: FunctionLikeDeclaration,
  checker: Checker,
): TypeExtractionResult => {
  const types: string[] = [];
  let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  const visit = (node: Node): void => {
    if (
      isCallExpression(node)
      && isIdentifier(node.expression)
      && STREAM_EMIT_NAMES.has(node.expression.text)
    ) {
      const callName = node.expression.text;
      //? streamTo(tokens, payload) — payload is at index 1; everything else
      //? puts the payload at index 0.
      const payloadIndex = callName === 'streamTo' ? 1 : 0;
      const payloadArg = node.arguments[payloadIndex];

      if (payloadArg) {
        const argType = checker.getTypeAtLocation(payloadArg);
        const nonNullableArgType = checker.getNonNullableType(argType);
        //? OUTPUT — a streamed payload is JSON on the wire like any other.
        const expanded = expandTypeDetailed(nonNullableArgType, checker, 0, undefined, { wireProjection: true });

        if (expanded.text.trim().length > 0) {
          types.push(expanded.text);
        }

        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
        unresolvedSymbols = mergeUnresolvedSymbols(
          unresolvedSymbols,
          collectFallbackSymbolsFromTypeText(expanded.text, payloadArg, checker),
        );
      }
    }

    // Recurse into control flow but not into nested function bodies
    if (
      !isArrowFunction(node)
      && !isFunctionExpression(node)
      && !isFunctionDeclaration(node)
    ) {
      node.forEachChild(visit);
    }
  };

  funcNode.forEachChild(visit);
  return { text: unionTypes(types), unresolvedSymbols };
};

// Returns the deduplicated union of an array of type strings.
const unionTypes = (types: string[]): string => {
  const unique = [...new Set(types)];
  return unique.length > 0 ? unique.join(' | ') : '';
};

//? @adr 0029 — JSON transports cannot deliver a Date instance. Keeping `Date` in a route's
//? input annotation makes both the generated client signature and the handler
//? promise an instance while runtime receives an ISO string. Refuse that source
//? contract instead of accepting a value on which Date methods will throw.
class UnsupportedTransportInputError extends Error {
  constructor(filePath: string) {
    super(`[TypeMapGenerator] ${filePath} declares Date in a transport input. JSON delivers an ISO string; declare string and validate/convert it explicitly.`);
    this.name = 'UnsupportedTransportInputError';
  }
}

const assertTransportInputIsWireSafe = (typeText: string, filePath: string): void => {
  const sourceFile = parseSourceText(
    '__luckystack_input_check.ts',
    `type __LuckyStackInput = ${typeText};`,
    ScriptKind.TS,
  );
  const containsDate = (node: Node): boolean => {
    if (
      isTypeReferenceNode(node)
      && isIdentifier(node.typeName)
      && node.typeName.text === 'Date'
    ) {
      return true;
    }
    return node.getChildren(sourceFile).some((child) => containsDate(child));
  };
  if (containsDate(sourceFile)) throw new UnsupportedTransportInputError(filePath);
};

//  public API 

export const getInputTypeFromFile = (filePath: string): string => {
  return getInputTypeDetailsFromFile(filePath).text;
};

export const getInputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';
  //? Cleared on ENTRY, set only from the catch — so an early bail-out below
  //? (no source file / no ApiParams / no `data`) cannot leave a stale verdict.
  recordExtractionOutcome({ filePath, kind: 'api', field: 'input', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      //? Marker-contract (DD-DEVKIT-D1): a getSourceFile miss is always a loud
      //? warning, never silent. The generator invalidates the TS Program cache
      //? before every upsert, so a miss here means the file is genuinely absent
      //? from the Program (e.g. added to disk but tsconfig globs not updated).
      //? The route falls back to `{ }` (empty input) until the next full rebuild.
      //? The fallback is surfaced in `apiTypeDiagnostics.generated.json` so it
      //? is visible without parsing console output.
      console.warn(`[TypeMapGenerator] getSourceFile miss for ${filePath} — input types will default to { }`);
      return { text: DEFAULT, unresolvedSymbols: [] };
    }

    const iface = findInterface(sourceFile, 'ApiParams');
    if (!iface) return { text: DEFAULT, unresolvedSymbols: [] };

    const dataType = getInterfacePropertyType(iface, 'data', checker);
    if (!dataType) return { text: DEFAULT, unresolvedSymbols: [] };

    const expanded = expandTypeDetailed(dataType, checker);
    assertTransportInputIsWireSafe(expanded.text, filePath);
    return { text: expanded.text || DEFAULT, unresolvedSymbols: expanded.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedTransportInputError) throw error;
    console.error(`[TypeMapGenerator] Error extracting input type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'api', field: 'input', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getOutputTypeFromFile = (filePath: string): string => {
  return getOutputTypeDetailsFromFile(filePath).text;
};

export const getApiStreamPayloadTypeFromFile = (filePath: string): string => {
  return getApiStreamPayloadTypeDetailsFromFile(filePath).text;
};

//? DEVKIT-4 fallback. `collectStreamCallPayloadTypeDetails` only sees LITERAL
//? `stream(...)` calls inside `main`. A route that hands its emitter to a helper
//? (`eventBroadcaster.buildBroadcaster(stream)`) has zero literal calls → the
//? payload type would degrade to `never`, which the framework's typed
//? `onStream` rejects. When that happens, read the declared payload type off the
//? `stream: ApiStreamEmitter<T>` annotation on the `ApiParams` interface instead
//? (`ApiStreamEmitter<T>` / the Sync emitter types all carry the payload as
//? their single type argument).
const STREAM_EMITTER_TYPE_NAMES = new Set([
  'ApiStreamEmitter',
  'SyncServerStreamEmitter',
  'SyncClientStreamEmitter',
  'SyncBroadcastStreamEmitter',
  'SyncStreamToEmitter',
]);

const extractDeclaredStreamTypeFromApiParams = (
  sourceFile: SourceFile,
  checker: Checker,
): TypeExtractionResult | null => {
  let result: TypeExtractionResult | null = null;

  const visit = (node: Node): void => {
    if (result) return;
    //? The route's params interface — `ApiParams` (API) / `SyncServerParams`
    //? etc. Convention names all end in `Params`.
    if (isInterfaceDeclaration(node) && node.name.text.endsWith('Params')) {
      for (const member of node.members) {
        if (
          isPropertySignatureDeclaration(member)
          && isIdentifier(member.name)
          && member.name.text === 'stream'
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TS 7.1 declares PropertySignature.type required, but it is undefined for `{ a; }`
          && member.type
          && isTypeReferenceNode(member.type)
          && isIdentifier(member.type.typeName)
          && STREAM_EMITTER_TYPE_NAMES.has(member.type.typeName.text)
        ) {
          const typeArg = member.type.typeArguments?.[0];
          if (typeArg) {
            const argType = checker.getNonNullableType(checker.getTypeFromTypeNode(typeArg));
            //? OUTPUT — the declared ApiStreamEmitter<T> payload (DEVKIT-4 path).
            const expanded = expandTypeDetailed(argType, checker, 0, undefined, { wireProjection: true });
            if (expanded.text.trim().length > 0) {
              result = { text: expanded.text, unresolvedSymbols: expanded.unresolvedSymbols };
              return;
            }
          }
        }
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return result;
};

export const getApiStreamPayloadTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = 'never';
  recordExtractionOutcome({ filePath, kind: 'api', field: 'stream', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    if (details.text !== '') return details;

    //? No literal stream() call — fall back to the declared ApiParams.stream type.
    const declared = extractDeclaredStreamTypeFromApiParams(sourceFile, checker);
    if (declared) return declared;

    return { text: DEFAULT, unresolvedSymbols: [] };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting API stream payload type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'api', field: 'stream', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ status: string }';
  recordExtractionOutcome({ filePath, kind: 'api', field: 'output', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting output type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'api', field: 'output', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncClientDataType = (filePath: string): string => {
  return getSyncClientDataTypeDetailsFromFile(filePath).text;
};

export const getSyncClientDataTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';
  recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientInput', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const iface = findInterface(sourceFile, 'SyncParams');
    if (!iface) return { text: DEFAULT, unresolvedSymbols: [] };

    // Try clientInput first, then clientData (legacy name)
    const dataType =
      getInterfacePropertyType(iface, 'clientInput', checker)
      ?? getInterfacePropertyType(iface, 'clientData', checker);
    if (!dataType) return { text: DEFAULT, unresolvedSymbols: [] };

    const expanded = expandTypeDetailed(dataType, checker);
    assertTransportInputIsWireSafe(expanded.text, filePath);
    return { text: expanded.text || DEFAULT, unresolvedSymbols: expanded.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedTransportInputError) throw error;
    console.error(`[TypeMapGenerator] Error extracting sync clientData type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientInput', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncServerOutputType = (filePath: string): string => {
  return getSyncServerOutputTypeDetailsFromFile(filePath).text;
};

export const getSyncServerStreamPayloadTypeFromFile = (filePath: string): string => {
  return getSyncServerStreamPayloadTypeDetailsFromFile(filePath).text;
};

export const getSyncServerStreamPayloadTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = 'never';
  recordExtractionOutcome({ filePath, kind: 'sync', field: 'serverStream', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting sync server stream payload type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'sync', field: 'serverStream', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncServerOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ status: string }';
  recordExtractionOutcome({ filePath, kind: 'sync', field: 'serverOutput', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting sync serverOutput type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'sync', field: 'serverOutput', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncClientOutputType = (filePath: string): string => {
  return getSyncClientOutputTypeDetailsFromFile(filePath).text;
};

export const getSyncClientStreamPayloadTypeFromFile = (filePath: string): string => {
  return getSyncClientStreamPayloadTypeDetailsFromFile(filePath).text;
};

export const getSyncClientStreamPayloadTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = 'never';
  recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientStream', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting sync client stream payload type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientStream', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncClientOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';
  recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientOutput', error: null });

  try {
    const { program, checker } = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    if (error instanceof UnsupportedWireTypeError) throw error;
    console.error(`[TypeMapGenerator] Error extracting sync clientOutput type from ${filePath}:`, error);
    recordExtractionOutcome({ filePath, kind: 'sync', field: 'clientOutput', error });
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

