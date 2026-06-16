import * as ts from 'typescript';
import fs from 'node:fs';
import { inferHttpMethod, tryCatchSync } from '@luckystack/core';

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

//? Unwrap `as const` / `as T` / `satisfies T` / parenthesized wrappers so an
//? initializer like `'DELETE' as const` is read as its underlying literal.
//? The TS AST wraps these in AsExpression / SatisfiesExpression /
//? ParenthesizedExpression nodes that the literal-type guards below would
//? otherwise skip — silently dropping the authored value and falling back to
//? an inferred default. Solving the wrapper class once covers every extractor.
const unwrapExpression = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

export const extractHttpMethod = (filePath: string, apiName: string): HttpMethod => {
  const [error, method] = tryCatchSync((): HttpMethod | undefined => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'httpMethod');

    const initializer = decl?.initializer ? unwrapExpression(decl.initializer) : undefined;
    if (initializer && ts.isStringLiteral(initializer)) {
      const candidate = initializer.text.toUpperCase() as HttpMethod;
      if (['GET', 'POST', 'PUT', 'DELETE'].includes(candidate)) return candidate;
    }
    return undefined;
  });

  if (error) {
    console.error(`[TypeMapGenerator] Error extracting httpMethod from ${filePath}:`, error);
  }

  return method ?? inferHttpMethod(apiName);
};

export const extractRateLimit = (filePath: string): number | false | undefined => {
  const [error, rateLimit] = tryCatchSync((): number | false | undefined => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'rateLimit');

    if (decl?.initializer) {
      const initializer = unwrapExpression(decl.initializer);
      if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (ts.isNumericLiteral(initializer)) return Number(initializer.text);
    }
    return undefined;
  });

  if (error) {
    console.error(`[TypeMapGenerator] Error extracting rateLimit from ${filePath}:`, error);
  }

  return rateLimit ?? undefined;
};

/**
 * Reads the `export const validation` declaration from an API/sync source
 * file. Supports `'strict'`, `'relaxed'`, and `{ input: 'skip' | 'strict' }`.
 * Returns undefined when the export is absent (consumer hasn't opted out).
 */
export type ApiValidationMode = 'strict' | 'relaxed' | { input: 'skip' | 'strict' };

export const extractValidation = (filePath: string): ApiValidationMode | undefined => {
  const [error, validation] = tryCatchSync((): ApiValidationMode | undefined => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'validation');

    if (!decl?.initializer) return undefined;
    const initializer = unwrapExpression(decl.initializer);

    if (ts.isStringLiteral(initializer)) {
      const text = initializer.text;
      if (text === 'strict' || text === 'relaxed') return text;
    }

    if (ts.isObjectLiteralExpression(initializer)) {
      for (const prop of initializer.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text !== 'input') continue;
        const propInit = unwrapExpression(prop.initializer);
        if (!ts.isStringLiteral(propInit)) continue;
        const input = propInit.text;
        if (input === 'skip' || input === 'strict') return { input };
      }
    }
    return undefined;
  });

  if (error) {
    console.error(`[TypeMapGenerator] Error extracting validation from ${filePath}:`, error);
  }

  return validation ?? undefined;
};

// Reads a primitive value from an AST expression node.
const readPrimitive = (rawNode: ts.Expression): string | number | boolean | undefined => {
  const node = unwrapExpression(rawNode);
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

//? Flatten a JSDoc tag comment (string or `ts.NodeArray` of comment parts) to text.
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

export const extractDocsMeta = (filePath: string): DocsMeta | undefined => {
  const [error, docsMeta] = tryCatchSync((): DocsMeta | undefined => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const result: DocsMeta = {};

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
  });

  if (error) {
    console.error(`[TypeMapGenerator] Error extracting @docs metadata from ${filePath}:`, error);
    return undefined;
  }

  return docsMeta ?? undefined;
};

export const extractAuth = (filePath: string): { login: boolean; additional?: Record<string, unknown>[] } => {
  const [, auth] = tryCatchSync((): { login: boolean; additional?: Record<string, unknown>[] } => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const decl = findExportedConst(sourceFile, 'auth');
    const authInitializer = decl?.initializer ? unwrapExpression(decl.initializer) : undefined;
    //? DK-05 (public-by-default): a route that omits `export const auth` — OR
    //? whose `auth` omits / non-literally sets `login` — extracts as PUBLIC
    //? (`login: false`), matching the dev runtime loader (`auth.login || false`),
    //? the generated `apiMetaMap`, and the test-runner auth sweep. The defect
    //? this closes was the runtime↔tooling DISAGREEMENT: the loader defaulted to
    //? public while this extractor defaulted to protected, so the generated meta
    //? + auth sweep disagreed with what actually ran. A route that needs auth
    //? MUST declare a literal `auth: { login: true }`.
    if (!authInitializer || !ts.isObjectLiteralExpression(authInitializer)) return { login: false };

    let login = false;
    let additional: Record<string, unknown>[] | undefined;

    for (const prop of authInitializer.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
      const propInit = unwrapExpression(prop.initializer);

      if (prop.name.text === 'login') {
        login = propInit.kind === ts.SyntaxKind.TrueKeyword;
      }

      if (prop.name.text === 'additional' && ts.isArrayLiteralExpression(propInit)) {
        additional = [];
        for (const element of propInit.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const item = parseAdditionalItem(element);
          if (item) additional.push(item);
        }
      }
    }

    return additional && additional.length > 0 ? { login, additional } : { login };
  });

  //? Parse failure falls through to PUBLIC, consistent with the public-by-default
  //? policy above (and the runtime loader). A route needing auth declares a
  //? literal `auth: { login: true }`.
  return auth ?? { login: false };
};

