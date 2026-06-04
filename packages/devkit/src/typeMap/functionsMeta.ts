import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { FileImport, ImportCollectors, parseFileTypeContext, sanitizeTypeAndCollectImports } from './typeContext';
import { getGeneratedSocketTypesPath, getServerFunctionDirs } from '@luckystack/core';
import { expandType, getServerProgram } from './tsProgram';

// Strips default parameter values from argument lists so the generated interface
// is a clean type signature without runtime values.
const stripDefaultValues = (params: string): string => {
  // Replace default values (= expr) while preserving arrow functions (=>)
  return params.replaceAll(/\s*=(?!>)[^,)]+/g, '');
};

// Strips `//` line comments from a raw type fragment while leaving string and
// template literals (which can legitimately contain `//`, e.g. a URL literal
// type) intact. Uses the TS scanner so `'https://x'` is never mistaken for a
// comment — a plain regex strip can't tell the two apart.
export const stripLineComments = (value: string): string => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    value,
  );
  let result = '';
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    // Replace `//` comments with a space so neighbouring tokens don't glue
    // together; keep everything else verbatim, including block comments.
    result += token === ts.SyntaxKind.SingleLineCommentTrivia ? ' ' : scanner.getTokenText();
    token = scanner.scan();
  }
  return result;
};

// Collapses a multi-line type fragment to a single clean line. Inline `//`
// comments MUST be stripped first: once the newlines are gone a surviving `//`
// would comment out the rest of the line and produce malformed generated
// TypeScript (later caught by validateGeneratedTypeIdentifiers).
export const normalizeInlineType = (value: string): string => {
  return stripLineComments(value).replaceAll(/\s+/g, ' ').trim();
};

const simplifyInferredType = (value: string): string => {
  if (/\bPrismaClient\b/.test(value)) return 'PrismaClient';
  if (/\bRedis\b/.test(value)) return 'Redis';
  return value;
};

//? Rewrites a relative module specifier so it resolves correctly when emitted
//? into `src/_sockets/apiTypes.generated.ts`. The specifier is relative to
//? `sourceFilePath` (the shim file); after this, it becomes relative to the
//? generated file's directory. Non-relative specifiers (package aliases,
//? node built-ins) pass through untouched.
//?
//? Before this lived, emitted paths were preserved verbatim and only worked
//? when the shim file shared a depth with the generated file (depth 2 from
//? repo root). Shims at other depths produced unresolvable type imports.
const getGeneratedFileDir = (): string => path.dirname(getGeneratedSocketTypesPath());

const relativizeModuleSpecifier = (specifier: string, sourceFilePath: string): string => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  const absolute = path.resolve(path.dirname(sourceFilePath), specifier);
  const rel = path.relative(getGeneratedFileDir(), absolute);
  const normalized = rel.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
};

const findProgramVariableDeclaration = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration;
      }
    }
  }

  return null;
};

const findProgramTypeDeclaration = (
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration | ts.EnumDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) return statement;
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) return statement;
    if (ts.isClassDeclaration(statement) && statement.name?.text === typeName) return statement;
    if (ts.isEnumDeclaration(statement) && statement.name.text === typeName) return statement;
  }

  return null;
};

const resolveLocalExportedTypes = ({
  type,
  availableExports,
  checker,
  programSource,
}: {
  type: string;
  availableExports: Set<string>;
  checker: ts.TypeChecker;
  programSource: ts.SourceFile;
}): string => {
  if (availableExports.size === 0) return type;

  let resolved = type;

  for (const exportName of availableExports) {
    const hasReference = new RegExp(String.raw`\b${exportName}\b`).test(resolved);
    if (!hasReference) continue;

    const declaration = findProgramTypeDeclaration(programSource, exportName);
    if (!declaration) continue;

    const declarationNode = (
      ts.isClassDeclaration(declaration)
      ? (declaration.name ?? declaration)
      : (ts.isTypeAliasDeclaration(declaration)
        ? declaration.type
        : declaration)
    );

    const declarationType = checker.getTypeAtLocation(declarationNode);
    const expanded = normalizeInlineType(expandType(declarationType, checker));

    resolved = resolved.replaceAll(new RegExp(String.raw`\b${exportName}\b`, 'g'), expanded);
  }

  return resolved;
};

const findSourceVariableDeclaration = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration;
      }
    }
  }

  return null;
};

const inferValueTypeForExport = ({
  exportName,
  declaration,
  rawContent,
  filePath,
  availableExports,
  fileImports,
  collectors,
  checker,
  programSource,
}: {
  exportName: string;
  declaration: ts.VariableDeclaration;
  rawContent: string;
  filePath: string;
  availableExports: Set<string>;
  fileImports: Map<string, FileImport>;
  collectors: ImportCollectors;
  checker?: ts.TypeChecker;
  programSource?: ts.SourceFile;
}): string => {
  const resolvedChecker = checker ?? getServerProgram().getTypeChecker();
  const resolvedSource = programSource ?? getServerProgram().getSourceFile(filePath);

  if (declaration.type) {
    const rawType = normalizeInlineType(rawContent.slice(declaration.type.pos, declaration.type.end).trim());
    const localResolvedType = resolvedSource
      ? resolveLocalExportedTypes({
        type: rawType,
        availableExports,
        checker: resolvedChecker,
        programSource: resolvedSource,
      })
      : rawType;

    return sanitizeTypeAndCollectImports({
      type: localResolvedType,
      filePath,
      availableExports,
      fileImports,
      collectors,
    });
  }

  try {
    if (!resolvedSource) return 'any';

    const programDeclaration = findProgramVariableDeclaration(resolvedSource, exportName);
    if (!programDeclaration) return 'any';

    const inferred = resolvedChecker.typeToString(resolvedChecker.getTypeAtLocation(programDeclaration.name));
    const simplified = simplifyInferredType(normalizeInlineType(inferred));
    const localResolvedType = resolveLocalExportedTypes({
      type: simplified,
      availableExports,
      checker: resolvedChecker,
      programSource: resolvedSource,
    });

    return sanitizeTypeAndCollectImports({
      type: localResolvedType,
      filePath,
      availableExports,
      fileImports,
      collectors,
    });
  } catch {
    return 'any';
  }
};

// Extracts a function signature string from an AST function-like node.
const extractSignatureFromNode = (
  node: ts.FunctionLikeDeclaration,
  rawContent: string,
  filePath: string,
  availableExports: Set<string>,
  fileImports: Map<string, FileImport>,
  collectors: ImportCollectors,
  checker?: ts.TypeChecker,
  programSource?: ts.SourceFile,
): string => {
  // Collect generic type parameter names to avoid replacing them with 'any'
  const knownGenerics = new Set<string>();
  if (node.typeParameters) {
    for (const typeParam of node.typeParameters) {
      knownGenerics.add(typeParam.name.text);
    }
  }

  const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

  // Generic clause text (<T, U extends string>)
  const genericsClause = node.typeParameters
    ? `<${normalizeInlineType(rawContent.slice(node.typeParameters.pos, node.typeParameters.end))}>`
    : '';

  // Parameter list text with default values removed
  const rawParams = node.parameters
    .map(p => normalizeInlineType(rawContent.slice(p.pos, p.end).trim()))
    .join(', ');
  const cleanParams = normalizeInlineType(stripDefaultValues(`(${rawParams})`));
  const localResolvedParams = (checker && programSource)
    ? resolveLocalExportedTypes({
      type: cleanParams,
      availableExports,
      checker,
      programSource,
    })
    : cleanParams;

  const sanitizedParams = sanitizeTypeAndCollectImports({
    type: localResolvedParams,
    filePath,
    availableExports,
    fileImports,
    knownGenerics,
    collectors,
  });

  // Return type annotation — emitted into generated type strings. Use
  // `unknown` (not `any`) so consumers must narrow at call sites.
  let returnTypeStr = isAsync ? 'Promise<unknown>' : 'unknown';
  if (node.type) {
    const rawReturnType = normalizeInlineType(rawContent.slice(node.type.pos, node.type.end).trim());
    const localResolvedReturnType = (checker && programSource)
      ? resolveLocalExportedTypes({
        type: rawReturnType,
        availableExports,
        checker,
        programSource,
      })
      : rawReturnType;

    returnTypeStr = sanitizeTypeAndCollectImports({
      type: localResolvedReturnType,
      filePath,
      availableExports,
      fileImports,
      knownGenerics,
      collectors,
    });
    if (isAsync && !returnTypeStr.startsWith('Promise')) {
      returnTypeStr = `Promise<${returnTypeStr}>`;
    }
  }

  return `${genericsClause}${sanitizedParams} => ${returnTypeStr}`;
};

// Finds and returns the signature for a named export within a parsed source file.
const findSignatureForExport = (
  name: string,
  sourceFile: ts.SourceFile,
  rawContent: string,
  filePath: string,
  availableExports: Set<string>,
  fileImports: Map<string, FileImport>,
  collectors: ImportCollectors,
  checker?: ts.TypeChecker,
  programSource?: ts.SourceFile,
): string => {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue;
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          return extractSignatureFromNode(decl.initializer, rawContent, filePath, availableExports, fileImports, collectors, checker, programSource);
        }
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return extractSignatureFromNode(statement, rawContent, filePath, availableExports, fileImports, collectors, checker, programSource);
    }
  }

  return 'any';
};

//? IR node shapes used by the multi-directory merge. Each root directory
//? produces an `IRDirNode` tree; multiple trees are merged with conflict
//? detection before final serialization to a TypeScript interface body.
interface IRFileNode {
  kind: 'file';
  exports: Map<string, string>;
  defaultExportName: string | null;
  //? Set when the file contains `export * from '<module>'` (wildcard
  //? re-export). When present and no other exports exist, the file is
  //? emitted as a single `name: typeof import('<module>')` so consumers
  //? get the full module shape on `functions.<name>.<...>`.
  wildcardReExport: string | null;
  sourcePath: string;
}

interface IRDirNode {
  kind: 'dir';
  children: Map<string, IRFileNode | IRDirNode>;
  sourcePath: string;
}

const parseFunctionFile = (fullPath: string, collectors: ImportCollectors): IRFileNode | null => {
  try {
    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const sourceFile = ts.createSourceFile(fullPath, rawContent, ts.ScriptTarget.Latest, true);
    const { availableExports, fileImports } = parseFileTypeContext(rawContent);
    const program = getServerProgram();
    const checker = program.getTypeChecker();
    const programSource = program.getSourceFile(fullPath);
    const exports = new Map<string, string>();
    let defaultExportName: string | null = null;
    let wildcardReExport: string | null = null;

    for (const statement of sourceFile.statements) {
        const hasExport = (statement as ts.HasModifiers).modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

        if (ts.isVariableStatement(statement) && hasExport) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const exportName = decl.name.text;

              if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
                exports.set(exportName, findSignatureForExport(exportName, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined));
                continue;
              }

              exports.set(exportName, inferValueTypeForExport({
                exportName,
                declaration: decl,
                rawContent,
                filePath: fullPath,
                availableExports,
                fileImports,
                collectors,
                checker,
                programSource: programSource ?? undefined,
              }));
            }
          }
        }

        if (ts.isFunctionDeclaration(statement) && hasExport && statement.name) {
          exports.set(statement.name.text, findSignatureForExport(statement.name.text, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined));
        }

        // export { a, b as c } [from 'module']
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          // `export { x } from 'module'` — extract the source module so we can
          // emit `typeof import('module')['x']` and let TypeScript resolve the
          // real type at compile time (instead of falling back to `any`).
          const moduleSpecifier =
            statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : null;

          for (const specifier of statement.exportClause.elements) {
            const exportName = specifier.name.text;
            const originalName = specifier.propertyName ? specifier.propertyName.text : exportName;

            if (moduleSpecifier) {
              // Re-export from another module. `typeof import(...)` resolves
              // through package aliases (`@luckystack/*`) and relative paths.
              // Relative paths are rewritten to be relative to the generated
              // file location, so shims at any depth produce working imports.
              // Package aliases (starting with `@` or a word char but no
              // `.` / `/`) pass through. Wildcard re-exports (`export * from
              // ...`) are not handled here and fall through.
              const resolvedSpecifier = relativizeModuleSpecifier(moduleSpecifier, fullPath);
              exports.set(exportName, `typeof import('${resolvedSpecifier}')['${originalName}']`);
              continue;
            }

            const signature = findSignatureForExport(originalName, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined);
            if (signature !== 'any') {
              exports.set(exportName, signature);
              continue;
            }

            const exportDeclaration = findSourceVariableDeclaration(sourceFile, originalName);
            if (exportDeclaration && ts.isIdentifier(exportDeclaration.name)) {
              exports.set(exportName, inferValueTypeForExport({
                exportName: originalName,
                declaration: exportDeclaration,
                rawContent,
                filePath: fullPath,
                availableExports,
                fileImports,
                collectors,
                checker,
                programSource: programSource ?? undefined,
              }));
              continue;
            }

            exports.set(exportName, 'any');
          }
        }

        // export default someIdentifier
        if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
          defaultExportName = statement.expression.text;
        }

        // export * from 'module' — wildcard re-export. Stash the resolved
        // module specifier; serialization decides whether to emit it.
        if (
          ts.isExportDeclaration(statement)
          && !statement.exportClause
          && statement.moduleSpecifier
          && ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          wildcardReExport = relativizeModuleSpecifier(statement.moduleSpecifier.text, fullPath);
        }
      }

    return { kind: 'file', exports, defaultExportName, wildcardReExport, sourcePath: fullPath };
  } catch (error) {
    console.error(`[TypeMapGenerator] Error parsing functions file ${fullPath}:`, error);
    return null;
  }
};

const walkDirToIR = (dir: string, collectors: ImportCollectors): IRDirNode | null => {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const children = new Map<string, IRFileNode | IRDirNode>();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subDir = walkDirToIR(fullPath, collectors);
      if (subDir && subDir.children.size > 0) {
        children.set(entry.name, subDir);
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;

    const fileName = entry.name.replace('.ts', '');
    const parsed = parseFunctionFile(fullPath, collectors);
    if (parsed && (parsed.exports.size > 0 || parsed.defaultExportName !== null || parsed.wildcardReExport !== null)) {
      children.set(fileName, parsed);
    }
  }

  return { kind: 'dir', children, sourcePath: dir };
};

const formatConflict = (keyPath: string[], a: IRFileNode | IRDirNode, b: IRFileNode | IRDirNode): string => {
  const dottedKey = keyPath.join('.');
  return (
    `[function-injection] Conflict at \`functions.${dottedKey}\`: ` +
    `defined in both \`${a.sourcePath}\` and \`${b.sourcePath}\`. ` +
    `Delete one — \`shared/\` is the canonical location for framework re-exports.`
  );
};

//? Merge `source` INTO `target` in place, throwing on conflicts. A "conflict"
//? is one of:
//?   - same key path mapped to a file in both roots
//?   - same key path mapped to a file in one root and a directory in another
//? Two directories with the same name merge recursively without warning so
//? that `functions/admin/users.ts` + `shared/admin/roles.ts` produce
//? `functions.admin.{users, roles}` cleanly.
const mergeIR = (target: IRDirNode, source: IRDirNode, prefix: string[] = []): void => {
  for (const [name, sourceChild] of source.children) {
    const targetChild = target.children.get(name);
    if (!targetChild) {
      target.children.set(name, sourceChild);
      continue;
    }
    const keyPath = [...prefix, name];
    if (targetChild.kind !== sourceChild.kind) {
      throw new Error(formatConflict(keyPath, targetChild, sourceChild));
    }
    if (targetChild.kind === 'file' || sourceChild.kind === 'file') {
      throw new Error(formatConflict(keyPath, targetChild, sourceChild));
    }
    mergeIR(targetChild, sourceChild, keyPath);
  }
};

const serializeIRDir = (dir: IRDirNode, indent: string): string => {
  let output = '';
  for (const [name, child] of dir.children) {
    if (child.kind === 'dir') {
      const subOutput = serializeIRDir(child, `${indent}  `);
      if (subOutput.trim()) {
        output += `${indent}${name}: {\n${subOutput}${indent}};\n`;
      }
      continue;
    }

    const exportsCopy = new Map(child.exports);
    const defaultExportName = child.defaultExportName;
    const defaultSig = defaultExportName ? exportsCopy.get(defaultExportName) : undefined;
    if (defaultSig && defaultExportName) exportsCopy.delete(defaultExportName);

    //? Wildcard re-export (`export * from '<module>'`) — emit the file as a
    //? single `name: typeof import('<module>')` so the full module surface
    //? becomes typed under `functions.<name>.<exportFromSource>`. When the
    //? file ALSO has named/default exports, the wildcard is dropped (this
    //? combined form is rare; the named exports take precedence to avoid an
    //? awkward intersection type).
    if (child.wildcardReExport && exportsCopy.size === 0 && !defaultSig) {
      output += `${indent}${name}: typeof import('${child.wildcardReExport}');\n`;
      continue;
    }

    //? Default-only re-exports (`export { default } from '...'`) end up as a
    //? single 'default' key with no `export default <identifier>` statement.
    //? Alias it to the filename so consumers can call `functions.<name>.<name>()`
    //? instead of the awkward `functions.<name>.default()`.
    if (!defaultSig && exportsCopy.size === 1 && exportsCopy.has('default')) {
      const reExportSig = exportsCopy.get('default');
      if (reExportSig) {
        exportsCopy.delete('default');
        exportsCopy.set(name, reExportSig);
      }
    }

    let fileOutput = '';
    for (const [exportName, sig] of exportsCopy) {
      fileOutput += `${indent}  ${exportName}: ${sig};\n`;
    }
    if (defaultSig && !fileOutput.trim()) {
      fileOutput += `${indent}  ${name}: ${defaultSig};\n`;
    }
    if (fileOutput) {
      output += `${indent}${name}: {\n${fileOutput}${indent}};\n`;
    }
  }
  return output;
};

export const generateServerFunctions = (collectors: ImportCollectors): string => {
  const dirs = getServerFunctionDirs();
  if (dirs.length === 0) return '';

  const merged: IRDirNode = { kind: 'dir', children: new Map(), sourcePath: '<merged>' };
  for (const dir of dirs) {
    const ir = walkDirToIR(dir, collectors);
    if (!ir) continue;
    mergeIR(merged, ir);
  }

  return serializeIRDir(merged, '\t');
};

