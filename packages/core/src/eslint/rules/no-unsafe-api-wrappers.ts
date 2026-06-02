//? Rule: forbid local wrappers around `apiRequest` whose parameter types
//? erase the route/version generics. The framework's type system relies on
//? literal `name`/`version` strings to infer `serverOutput` / `clientOutput`.
//? A wrapper like:
//?
//?   const unsafeApi = (name: string, version: string, data: unknown) =>
//?     apiRequest({ name: name as any, ... });
//?
//? destroys that inference. Always call `apiRequest` directly with route
//? literals, or write a wrapper that preserves the generics.
//?
//? Gated by hasPackage('@luckystack/api') at the config-composition layer.

//? Double-cast + any-spread disabled file-wide: bridges `Rule.Node` to specific
//? AST shapes; the spread iterates over `Object.entries(node)` whose values are
//? typed as `any` because eslint's AST shape varies by node kind.
/* eslint-disable no-restricted-syntax, @typescript-eslint/no-unsafe-argument */

import type { EslintRule } from '../internal/ruleTypes.js';

const SUSPECT_PARAM_NAMES = new Set(['name', 'version', 'route', 'apiName']);

//? AST keys that point to parents or non-AST metadata. Including them in
//? a recursive descent causes infinite loops because eslint adds `parent`
//? pointers during traversal.
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

const containsApiRequestCall = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const visited = new WeakSet<object>();
  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const node = stack.pop() as Record<string, unknown> | null;
    if (!node || typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const callee = (node as { type?: string; callee?: { type?: string; name?: string } }).callee;
    if (
      (node as { type?: string }).type === 'CallExpression' &&
      callee?.type === 'Identifier' &&
      (callee.name === 'apiRequest' || callee.name === 'syncRequest')
    ) {
      return true;
    }
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
};

const isSuspectFunction = (node: {
  params?: { type?: string; name?: string; typeAnnotation?: { typeAnnotation?: { type?: string } } }[];
  body?: unknown;
}): boolean => {
  if (!node.params || node.params.length === 0) return false;
  const hasSuspectStringParam = node.params.some((p) => {
    if (p.type !== 'Identifier' || !p.name) return false;
    if (!SUSPECT_PARAM_NAMES.has(p.name)) return false;
    const annotation = p.typeAnnotation?.typeAnnotation?.type;
    return annotation === 'TSStringKeyword';
  });
  if (!hasSuspectStringParam) return false;
  return containsApiRequestCall(node.body);
};

const rule: EslintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow local wrappers around `apiRequest` / `syncRequest` whose `name`/`version` params are typed as plain `string` — this erases the generic route/version inference.',
    },
    messages: {
      unsafeWrapper:
        'This wrapper around `apiRequest` / `syncRequest` accepts `{{paramName}}: string` and erases the route/version generic inference. Call the framework helper directly with literal route names, or type the parameter as a literal union (e.g. `name: \'examples/getUserData\'`).',
    },
    schema: [],
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (isSuspectFunction(node)) {
          const suspect = (node.params as { name?: string }[]).find((p) => p.name && SUSPECT_PARAM_NAMES.has(p.name));
          context.report({ node, messageId: 'unsafeWrapper', data: { paramName: suspect?.name ?? 'name' } });
        }
      },
      ArrowFunctionExpression(node) {
        if (isSuspectFunction(node)) {
          const suspect = (node.params as { name?: string }[]).find((p) => p.name && SUSPECT_PARAM_NAMES.has(p.name));
          context.report({ node, messageId: 'unsafeWrapper', data: { paramName: suspect?.name ?? 'name' } });
        }
      },
    };
  },
};

export default rule;
