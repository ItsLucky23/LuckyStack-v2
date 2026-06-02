//? Rule: same shape as no-unsafe-api-wrappers, but targeting wrappers
//? around `syncRequest` and `upsertSyncEventCallback`. Gated by
//? hasPackage('@luckystack/sync') at the config-composition layer.
//?
//? Note: the api-wrappers rule already covers the `syncRequest` call site;
//? this rule additionally catches `upsertSyncEventCallback` wrappers and
//? exists as a distinct identity so the sync-only rule can be disabled
//? independently when a consumer uses api but not sync.

//? Double-cast + any-spread disabled file-wide: bridges `Rule.Node` to specific
//? AST shapes; the spread iterates over `Object.entries(node)` whose values are
//? typed as `any` because eslint's AST shape varies by node kind.
/* eslint-disable no-restricted-syntax, @typescript-eslint/no-unsafe-argument */

import type { EslintRule } from '../internal/ruleTypes.js';

const SUSPECT_PARAM_NAMES = new Set(['name', 'version', 'route', 'syncName']);
const SUSPECT_CALLEES = new Set(['syncRequest', 'upsertSyncEventCallback']);

//? AST keys that point to parents or non-AST metadata. Skipped to avoid
//? infinite loops when eslint adds `parent` pointers during traversal.
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

const containsSuspectCall = (body: unknown): boolean => {
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
      SUSPECT_CALLEES.has(callee.name ?? '')
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

const isSuspect = (node: {
  params?: { type?: string; name?: string; typeAnnotation?: { typeAnnotation?: { type?: string } } }[];
  body?: unknown;
}): boolean => {
  if (!node.params || node.params.length === 0) return false;
  const hasSuspectStringParam = node.params.some((p) => {
    if (p.type !== 'Identifier' || !p.name) return false;
    if (!SUSPECT_PARAM_NAMES.has(p.name)) return false;
    return p.typeAnnotation?.typeAnnotation?.type === 'TSStringKeyword';
  });
  if (!hasSuspectStringParam) return false;
  return containsSuspectCall(node.body);
};

const rule: EslintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow local wrappers around `syncRequest` / `upsertSyncEventCallback` whose `name`/`version` params are typed as plain `string`.',
    },
    messages: {
      unsafeSyncWrapper:
        'This wrapper around `syncRequest` / `upsertSyncEventCallback` accepts a `string` route param and erases the generic event-payload inference. Call the framework helper directly with literal route names.',
    },
    schema: [],
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (isSuspect(node)) {
          context.report({ node, messageId: 'unsafeSyncWrapper' });
        }
      },
      ArrowFunctionExpression(node) {
        if (isSuspect(node)) {
          context.report({ node, messageId: 'unsafeSyncWrapper' });
        }
      },
    };
  },
};

export default rule;
