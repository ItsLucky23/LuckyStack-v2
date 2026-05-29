import * as ts from 'typescript';
import fs from 'node:fs';
import { inferHttpMethod } from '@luckystack/core';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Finds an exported const declaration by name in a source file's top-level statements.
const findExportedConst = (sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const hasExport = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
    }
  }
  return null;
};

export const extractHttpMethod = (filePath: string, apiName: string): HttpMethod => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'httpMethod');

    if (decl?.initializer && ts.isStringLiteral(decl.initializer)) {
      const method = decl.initializer.text.toUpperCase() as HttpMethod;
      if (['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return method;
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting httpMethod from ${filePath}:`, error);
  }

  return inferHttpMethod(apiName);
};

export const extractRateLimit = (filePath: string): number | false | undefined => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'rateLimit');

    if (decl?.initializer) {
      if (decl.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (ts.isNumericLiteral(decl.initializer)) return Number(decl.initializer.text);
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting rateLimit from ${filePath}:`, error);
  }

  return undefined;
};

/**
 * Reads the `export const validation` declaration from an API/sync source
 * file. Supports `'strict'`, `'relaxed'`, and `{ input: 'skip' | 'strict' }`.
 * Returns undefined when the export is absent (consumer hasn't opted out).
 */
export type ApiValidationMode = 'strict' | 'relaxed' | { input: 'skip' | 'strict' };

export const extractValidation = (filePath: string): ApiValidationMode | undefined => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'validation');

    if (!decl?.initializer) return undefined;

    if (ts.isStringLiteral(decl.initializer)) {
      const text = decl.initializer.text;
      if (text === 'strict' || text === 'relaxed') return text;
    }

    if (ts.isObjectLiteralExpression(decl.initializer)) {
      for (const prop of decl.initializer.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text !== 'input') continue;
        if (!ts.isStringLiteral(prop.initializer)) continue;
        const input = prop.initializer.text;
        if (input === 'skip' || input === 'strict') return { input };
      }
    }
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting validation from ${filePath}:`, error);
  }

  return undefined;
};

// Reads a primitive value from an AST expression node.
const readPrimitive = (node: ts.Expression): string | number | boolean | undefined => {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
};

const parseAdditionalItem = (objectLiteral: ts.ObjectLiteralExpression): Record<string, unknown> | null => {
  const item: Record<string, unknown> = {};

  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const value = readPrimitive(prop.initializer);
    if (value !== undefined) item[prop.name.text] = value;
  }

  return item.key ? item : null;
};

/**
 * AST-extracted JSDoc `@docs` metadata for a route file. Parsed from JSDoc
 * blocks attached to top-level statements (typically the `main` export).
 *
 * Convention (matches docs-ui renderer in `packages/docs-ui/src/docsHtml.ts`):
 *
 *   /\*\*
 *    * Description sentence.
 *    * @docs owner @mathijs
 *    * @docs tags admin, internal, deprecated-soon
 *    * @docs deprecated use api/billing/getInvoice/v2 instead
 *    *\/
 *   export const main = async (...) => {...};
 *
 * `@docs deprecated` without a reason -> `true` (renders as red "deprecated"
 * badge without explanation). With a reason -> `string` (renders the
 * explanation). `@docs tags` is comma-split + trimmed. Unknown sub-keys are
 * silently ignored so future tags don't break the parser.
 */
export interface DocsMeta {
  owner?: string;
  tags?: string[];
  deprecated?: string | true;
}

export const extractDocsMeta = (filePath: string): DocsMeta | undefined => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const result: DocsMeta = {};

    const commentToString = (commentValue: unknown): string => {
      if (typeof commentValue === 'string') return commentValue;
      if (Array.isArray(commentValue)) {
        return commentValue
          .map((part) => {
            if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
              return (part as { text: string }).text;
            }
            return '';
          })
          .join('');
      }
      return '';
    };

    const consumeTag = (tag: ts.JSDocTag): void => {
      if (tag.tagName.text !== 'docs') return;
      const commentText = commentToString(tag.comment).trim();
      if (commentText.length === 0) return;

      const spaceIdx = commentText.search(/\s/);
      const subkey = (spaceIdx === -1 ? commentText : commentText.slice(0, spaceIdx)).toLowerCase();
      const value = spaceIdx === -1 ? '' : commentText.slice(spaceIdx + 1).trim();

      if (subkey === 'owner' && value.length > 0) {
        result.owner = value;
      } else if (subkey === 'tags' && value.length > 0) {
        const tags = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        if (tags.length > 0) result.tags = tags;
      } else if (subkey === 'deprecated') {
        result.deprecated = value.length > 0 ? value : true;
      }
      //? unknown sub-keys: ignore (forward-compat for future @docs <key> tags)
    };

    //? Walk every top-level statement and collect JSDoc tags. This catches
    //? JSDoc on the `main` export, on the `auth`/`rateLimit` consts, or on
    //? any other top-level declaration — wherever the author wrote it.
    for (const statement of sourceFile.statements) {
      for (const tag of ts.getJSDocTags(statement)) {
        consumeTag(tag);
      }
    }

    if (result.owner === undefined && result.tags === undefined && result.deprecated === undefined) {
      return undefined;
    }
    return result;
  } catch (error) {
    console.error(`[TypeMapGenerator] Error extracting @docs metadata from ${filePath}:`, error);
    return undefined;
  }
};

export const extractAuth = (filePath: string): { login: boolean; additional?: Record<string, unknown>[] } => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'auth');
    if (!decl?.initializer || !ts.isObjectLiteralExpression(decl.initializer)) return { login: true };

    let login = true;
    let additional: Record<string, unknown>[] | undefined;

    for (const prop of decl.initializer.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

      if (prop.name.text === 'login') {
        login = prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
      }

      if (prop.name.text === 'additional' && ts.isArrayLiteralExpression(prop.initializer)) {
        additional = [];
        for (const element of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const item = parseAdditionalItem(element);
          if (item) additional.push(item);
        }
      }
    }

    return additional && additional.length > 0 ? { login, additional } : { login };
  } catch {
    // fall through
  }

  return { login: true };
};

