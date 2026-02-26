import ts from 'typescript';
import path from 'path';
import { GENERATED_SOCKET_TYPES_PATH } from '../../utils/paths';

export interface FileImport {
  source: string;
  isDefault: boolean;
  originalName?: string;
}

export interface ImportCollectors {
  namedImports: Map<string, Set<string>>;
  defaultImports: Map<string, string>;
}

const toGeneratedImportPath = (source: string, filePath: string): string => {
  if (!source.startsWith('.')) return source;

  const outputDir = path.dirname(GENERATED_SOCKET_TYPES_PATH);
  const absoluteSource = path.resolve(path.dirname(filePath), source);
  let relPath = path.relative(outputDir, absoluteSource).replace(/\\/g, '/');
  relPath = relPath.replace(/\.tsx?$/, '');
  if (!relPath.startsWith('.')) relPath = `./${relPath}`;
  return relPath;
};

// Parses a source file's AST to collect exported type names and import bindings.
// Uses ts.createSourceFile (no TypeChecker needed) for fast structural discovery.
export const parseFileTypeContext = (content: string): {
  availableExports: Set<string>;
  fileImports: Map<string, FileImport>;
} => {
  const availableExports = new Set<string>();
  const fileImports = new Map<string, FileImport>();

  const sourceFile = ts.createSourceFile(
    '__temp__.ts',
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of sourceFile.statements) {
    // Collect exported type/interface/class/enum declarations
    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      const hasExport = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      if (hasExport && statement.name) {
        availableExports.add(statement.name.text);
      }
      continue;
    }

    if (!ts.isImportDeclaration(statement)) continue;

    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;
    const source = moduleSpecifier.text;

    const importClause = statement.importClause;
    if (!importClause) continue;

    // Default import: import Foo from './foo'
    if (importClause.name) {
      fileImports.set(importClause.name.text, { source, isDefault: true });
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings) continue;

    // Namespace import: import * as Foo from './foo'
    if (ts.isNamespaceImport(namedBindings)) {
      fileImports.set(namedBindings.name.text, { source, isDefault: true });
      continue;
    }

    // Named imports: import { Foo, Bar as Baz } from './foo'
    if (ts.isNamedImports(namedBindings)) {
      for (const specifier of namedBindings.elements) {
        const localName = specifier.name.text;
        const originalName = specifier.propertyName?.text ?? localName;
        fileImports.set(localName, { source, isDefault: false, originalName });
      }
    }
  }

  return { availableExports, fileImports };
};

export const sanitizeTypeAndCollectImports = ({
  type,
  filePath,
  availableExports,
  fileImports,
  collectors,
  knownGenerics = new Set<string>(),
}: {
  type: string;
  filePath: string;
  availableExports: Set<string>;
  fileImports: Map<string, FileImport>;
  collectors: ImportCollectors;
  knownGenerics?: Set<string>;
}): string => {
  const { namedImports, defaultImports } = collectors;

  return type.replace(/\b([A-Z][a-zA-Z0-9_]*)(<[^>]+>)?(\[\])?\b/g, (match, typeName, _generics, isArray) => {
    const builtins = ['Promise', 'Date', 'Function', 'Array', 'Record', 'Partial', 'Pick', 'Omit', 'Error', 'Map', 'Set', 'Buffer', 'Uint8Array', 'Object'];
    const existingImports = ['PrismaClient', 'SessionLayout'];

    if (builtins.includes(typeName) || existingImports.includes(typeName) || knownGenerics.has(typeName)) {
      return match;
    }

    if (fileImports.has(typeName)) {
      const importConfig = fileImports.get(typeName)!;

      // If the import is from a package (not relative and not an internal alias), we can keep it
      // Internal aliases often start with 'src/' or 'shared/' or '@/'
      const isInternal = importConfig.source.startsWith('.') ||
        importConfig.source.startsWith('/') ||
        importConfig.source.startsWith('src/') ||
        importConfig.source.startsWith('shared/') ||
        importConfig.source.startsWith('server/');

      if (!isInternal) {
        const importPath = toGeneratedImportPath(importConfig.source, filePath);

        if (importConfig.isDefault) {
          if (!defaultImports.has(importPath) || defaultImports.get(importPath) === typeName) {
            defaultImports.set(importPath, typeName);
            return match;
          }
        } else {
          if (!namedImports.has(importPath)) namedImports.set(importPath, new Set());
          namedImports.get(importPath)!.add(importConfig.originalName || typeName);
          return match;
        }
      }
    }

    if (availableExports.has(typeName)) {
      // If it's exported locally in the same file, we used to add a relative import here,
      // but the user wants to flatten out our own types, so we don't import them anymore.
      // (The tsProgram.ts expandType handles API inputs/outputs deeply, 
      // but for functionsMeta.ts we just map them to `any` or leave them if they are built-ins).
      // If we *really* wanted to deeply flatten, we'd need to invoke the type checker. 
      // For now, mapping non-npm imports to `any` (the fallback below) handles the prompt.
    }

    return `any${isArray || ''}`;
  });
};
