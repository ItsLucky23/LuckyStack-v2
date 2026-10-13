import fs from 'node:fs';
import {
  getJSDocTags,
  SyntaxKind,
  type Expression,
  type JSDocTag,
  type ObjectLiteralExpression,
  type SourceFile,
  type VariableDeclaration,
} from 'typescript-7-api/ast';
import {
  isArrayLiteralExpression,
  isAsExpression,
  isIdentifier,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableStatement,
} from 'typescript-7-api/ast/is';
import { inferHttpMethod, tryCatchSync } from '@luckystack/core';

import { parseSourceText } from './tsApi';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Finds an exported const declaration by name in a source file's top-level statements.
const findExportedConst = (sourceFile: SourceFile, name: string): VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!isVariableStatement(statement)) continue;
    const hasExport = statement.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    for (const decl of statement.declarationList.declarations) {
      if (isIdentifier(decl.name) && decl.name.text === name) return decl;
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
const unwrapExpression = (node: Expression): Expression => {
  let current = node;
  while (
    isAsExpression(current)
    || isSatisfiesExpression(current)
    || isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

export const extractHttpMethod = (filePath: string, apiName: string): HttpMethod => {
  const [error, method] = tryCatchSync((): HttpMethod | undefined => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = parseSourceText(filePath, content);
    const decl = findExportedConst(sourceFile, 'httpMethod');

    const initializer = decl?.initializer ? unwrapExpression(decl.initializer) : undefined;
    if (initializer && isStringLiteral(initializer)) {
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
    const sourceFile = parseSourceText(filePath, content);
    const decl = findExportedConst(sourceFile, 'rateLimit');

    if (decl?.initializer) {
      const initializer = unwrapExpression(decl.initializer);
      if (initializer.kind === SyntaxKind.FalseKeyword) return false;
      if (isNumericLiteral(initializer)) return Number(initializer.text);
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
    const sourceFile = parseSourceText(filePath, content);
    const decl = findExportedConst(sourceFile, 'validation');

    if (!decl?.initializer) return undefined;
    const initializer = unwrapExpression(decl.initializer);

    if (isStringLiteral(initializer)) {
      const text = initializer.text;
      if (text === 'strict' || text === 'relaxed') return text;
    }

    if (isObjectLiteralExpression(initializer)) {
      for (const prop of initializer.properties) {
        if (!isPropertyAssignment(prop) || !isIdentifier(prop.name)) continue;
        if (prop.name.text !== 'input') continue;
        const propInit = unwrapExpression(prop.initializer);
        if (!isStringLiteral(propInit)) continue;
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
const readPrimitive = (rawNode: Expression): string | number | boolean | undefined => {
  const node = unwrapExpression(rawNode);
  if (isStringLiteral(node)) return node.text;
  if (isNumericLiteral(node)) return Number(node.text);
  if (node.kind === SyntaxKind.TrueKeyword) return true;
  if (node.kind === SyntaxKind.FalseKeyword) return false;
  return undefined;
};

const parseAdditionalItem = (objectLiteral: ObjectLiteralExpression): Record<string, unknown> | null => {
  const item: Record<string, unknown> = {};

  for (const prop of objectLiteral.properties) {
    if (!isPropertyAssignment(prop) || !isIdentifier(prop.name)) continue;
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

//? Flatten a JSDoc tag comment (string or `NodeArray` of comment parts) to text.
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
    const sourceFile = parseSourceText(filePath, content);

    const result: DocsMeta = {};

    const consumeTag = (tag: JSDocTag): void => {
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
      for (const tag of getJSDocTags(statement)) {
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

export const extractAuth = (filePath: string): { login: boolean; additional?: Record<string, unknown>[]; hasAdditional: boolean } => {
  const [, auth] = tryCatchSync((): { login: boolean; additional?: Record<string, unknown>[]; hasAdditional: boolean } => {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = parseSourceText(filePath, content);
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
    if (!authInitializer || !isObjectLiteralExpression(authInitializer)) return { login: false, hasAdditional: false };

    let login = false;
    let additional: Record<string, unknown>[] | undefined;
    //? Whether the route DECLARED a non-empty `additional: [...]` array — tracked
    //? from the raw element count BEFORE parseAdditionalItem (which drops non-object
    //? predicates like `additional: [adminOnly]` function refs). The test-runner's
    //? auth sweep gates on this so additional[]-only (login:false) authz routes are
    //? still probed, even when the predicates aren't serialisable into `additional`.
    let hasAdditional = false;

    for (const prop of authInitializer.properties) {
      if (!isPropertyAssignment(prop) || !isIdentifier(prop.name)) continue;
      const propInit = unwrapExpression(prop.initializer);

      if (prop.name.text === 'login') {
        login = propInit.kind === SyntaxKind.TrueKeyword;
      }

      if (prop.name.text === 'additional' && isArrayLiteralExpression(propInit)) {
        hasAdditional = propInit.elements.length > 0;
        additional = [];
        for (const element of propInit.elements) {
          if (!isObjectLiteralExpression(element)) continue;
          const item = parseAdditionalItem(element);
          if (item) additional.push(item);
        }
      }
    }

    return additional && additional.length > 0
      ? { login, additional, hasAdditional }
      : { login, hasAdditional };
  });

  //? Parse failure falls through to PUBLIC, consistent with the public-by-default
  //? policy above (and the runtime loader). A route needing auth declares a
  //? literal `auth: { login: true }`.
  return auth ?? { login: false, hasAdditional: false };
};

