/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import * as ts from 'typescript';
import path from 'node:path';
import { getServerProgram, expandTypeDetailed, ExpandedTypeResult, UnresolvedTypeSymbol } from './tsProgram';
import { ROOT_DIR } from '../../utils/paths';

export interface TypeExtractionResult extends ExpandedTypeResult {}

const TYPE_NAME_PATTERN = /\b[A-Z][A-Za-z0-9_]*\b/g;

const KNOWN_GLOBAL_TYPE_NAMES = new Set([
  'String', 'Number', 'Boolean', 'Object', 'Array', 'ReadonlyArray', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'RegExp', 'Error', 'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Awaited', 'JsonValue', 'JsonObject', 'JsonArray', 'JsonPrimitive',
]);

const normalizeImportPath = (targetFilePath: string): string => {
  const fromDir = path.join(ROOT_DIR, 'src', '_sockets');
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
  scopeNode: ts.Node,
  checker: ts.TypeChecker,
): UnresolvedTypeSymbol[] => {
  const names = new Set((typeText.match(TYPE_NAME_PATTERN) ?? []).filter((name) => !KNOWN_GLOBAL_TYPE_NAMES.has(name)));
  const symbolsInScope = checker.getSymbolsInScope(
    scopeNode,
    ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Alias,
  );

  const unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  for (const name of names) {
    const localSymbol = symbolsInScope.find((symbol) => symbol.name === name);
    if (!localSymbol) continue;

    const targetSymbol = (localSymbol.flags & ts.SymbolFlags.Alias) === 0
      ? localSymbol
      : checker.getAliasedSymbol(localSymbol);
    const declaration = targetSymbol.declarations?.[0];

    if (!declaration) {
      unresolvedSymbols.push({ name });
      continue;
    }

    const sourceFile = declaration.getSourceFile().fileName;
    if (!sourceFile || sourceFile.includes('/node_modules/') || sourceFile.includes('\\node_modules\\')) {
      continue;
    }

    unresolvedSymbols.push({
      name,
      sourceFile,
      importPath: normalizeImportPath(sourceFile),
    });
  }

  return unresolvedSymbols;
};

// Kept for backwards compatibility  callers outside this module may still import it.
export const stripComments = (str: string): string => {
  return str.replaceAll(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
};

//  shared helpers 

// Finds a top-level interface declaration by name in a source file's statements.
const findInterface = (sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | null => {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt;
  }
  return null;
};

// Reads the type of a named property inside an interface declaration.
const getInterfacePropertyType = (
  iface: ts.InterfaceDeclaration,
  propertyName: string,
  checker: ts.TypeChecker,
): ts.Type | null => {
  for (const member of iface.members) {
    if (
      ts.isPropertySignature(member)
      && member.name
      && ts.isIdentifier(member.name)
      && member.name.text === propertyName
      && member.type
    ) {
      return checker.getTypeFromTypeNode(member.type);
    }
  }
  return null;
};

// Finds the function-like initializer of `const main = ...` in a source file.
const findMainFunction = (sourceFile: ts.SourceFile): ts.FunctionLikeDeclaration | null => {
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name)
          && decl.name.text === 'main'
          && decl.initializer
          && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          return decl.initializer;
        }
      }
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'main') {
      return stmt;
    }
  }
  return null;
};

// Collects the expanded type strings of all object-literal return statements
// in a function body, without descending into nested function definitions.
const collectReturnObjectTypeDetails = (
  funcNode: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
): TypeExtractionResult => {
  const types: string[] = [];
  let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      const type = checker.getTypeAtLocation(node.expression);
      const expanded = expandTypeDetailed(type, checker);
      types.push(expanded.text);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      unresolvedSymbols = mergeUnresolvedSymbols(
        unresolvedSymbols,
        collectFallbackSymbolsFromTypeText(expanded.text, node.expression, checker),
      );
    }

    // Recurse into control flow but not into nested function bodies
    if (
      !ts.isArrowFunction(node)
      && !ts.isFunctionExpression(node)
      && !ts.isFunctionDeclaration(node)
    ) {
      ts.forEachChild(node, visit);
    }
  };

  ts.forEachChild(funcNode, visit);
  return { text: unionTypes(types), unresolvedSymbols };
};

// Collects the expanded payload type strings of stream(...) calls
// in a function body, without descending into nested function definitions.
const collectStreamCallPayloadTypeDetails = (
  funcNode: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
): TypeExtractionResult => {
  const types: string[] = [];
  let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'stream'
      && node.arguments.length > 0
    ) {
      const firstArg = node.arguments[0];
      const argType = checker.getTypeAtLocation(firstArg);
      const nonNullableArgType = checker.getNonNullableType(argType);
      const expanded = expandTypeDetailed(nonNullableArgType, checker);

      if (expanded.text.trim().length > 0) {
        types.push(expanded.text);
      }

      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      unresolvedSymbols = mergeUnresolvedSymbols(
        unresolvedSymbols,
        collectFallbackSymbolsFromTypeText(expanded.text, firstArg, checker),
      );
    }

    // Recurse into control flow but not into nested function bodies
    if (
      !ts.isArrowFunction(node)
      && !ts.isFunctionExpression(node)
      && !ts.isFunctionDeclaration(node)
    ) {
      ts.forEachChild(node, visit);
    }
  };

  ts.forEachChild(funcNode, visit);
  return { text: unionTypes(types), unresolvedSymbols };
};

// Returns the deduplicated union of an array of type strings.
const unionTypes = (types: string[]): string => {
  const unique = [...new Set(types)];
  return unique.length > 0 ? unique.join(' | ') : '';
};

//  public API 

export const getInputTypeFromFile = (filePath: string): string => {
  return getInputTypeDetailsFromFile(filePath).text;
};

export const getInputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const iface = findInterface(sourceFile, 'ApiParams');
    if (!iface) return { text: DEFAULT, unresolvedSymbols: [] };

    const dataType = getInterfacePropertyType(iface, 'data', checker);
    if (!dataType) return { text: DEFAULT, unresolvedSymbols: [] };

    const expanded = expandTypeDetailed(dataType, checker);
    return { text: expanded.text || DEFAULT, unresolvedSymbols: expanded.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting input type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getOutputTypeFromFile = (filePath: string): string => {
  return getOutputTypeDetailsFromFile(filePath).text;
};

export const getApiStreamPayloadTypeFromFile = (filePath: string): string => {
  return getApiStreamPayloadTypeDetailsFromFile(filePath).text;
};

export const getApiStreamPayloadTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = 'never';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting API stream payload type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ status: string }';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting output type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncClientDataType = (filePath: string): string => {
  return getSyncClientDataTypeDetailsFromFile(filePath).text;
};

export const getSyncClientDataTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const iface = findInterface(sourceFile, 'SyncParams');
    if (!iface) return { text: DEFAULT, unresolvedSymbols: [] };

    // Try clientInput first, then clientData (legacy name)
    const dataType =
      getInterfacePropertyType(iface, 'clientInput', checker)
      ?? getInterfacePropertyType(iface, 'clientData', checker);
    if (!dataType) return { text: DEFAULT, unresolvedSymbols: [] };

    const expanded = expandTypeDetailed(dataType, checker);
    return { text: expanded.text || DEFAULT, unresolvedSymbols: expanded.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientData type from ${filePath}:`, error);
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

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync server stream payload type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncServerOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ status: string }';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync serverOutput type from ${filePath}:`, error);
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

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectStreamCallPayloadTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync client stream payload type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

export const getSyncClientOutputTypeDetailsFromFile = (filePath: string): TypeExtractionResult => {
  const DEFAULT = '{ }';

  try {
    const program = getServerProgram();
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return { text: DEFAULT, unresolvedSymbols: [] };

    const checker = program.getTypeChecker();
    const mainFn = findMainFunction(sourceFile);
    if (!mainFn) return { text: DEFAULT, unresolvedSymbols: [] };

    const details = collectReturnObjectTypeDetails(mainFn, checker);
    return { text: details.text || DEFAULT, unresolvedSymbols: details.unresolvedSymbols };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting sync clientOutput type from ${filePath}:`, error);
    return { text: DEFAULT, unresolvedSymbols: [] };
  }
};

