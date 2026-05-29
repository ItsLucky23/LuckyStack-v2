//? Rule: forbid direct `fetch(...)` calls to framework `/api/*` or
//? `/sync/*` routes. The framework provides typed transport helpers
//? `apiRequest` (for `_api/` routes) and `syncRequest` (for `_sync/`
//? routes) which preserve route/version generics + auth/CSRF/validation.
//?
//? The rule is deliberately narrow:
//?   - Fires when the URL is a literal / template containing `/api/` or
//?     `/sync/` (framework route patterns).
//?   - Skips URLs whose PATH STARTS with `/auth/` — the framework's auth
//?     endpoints (`/auth/api/credentials`, OAuth callbacks) are HTTP-only
//?     and intentionally use raw fetch (cookies, headers, redirects). The
//?     start-of-path check (not `.includes`) means a consumer's typed
//?     route under an `auth/` page folder (URL `/api/auth/...`) still
//?     fires correctly.
//?   - Skips external URLs (starts with `http://`, `https://`, `//`) —
//?     consumers fetching third-party APIs are fine.
//?   - Skips dynamic URLs (variable, function call, etc.) — be permissive
//?     rather than flag-by-default; consumers can opt in via comments.
//?
//? Gated by hasPackage('@luckystack/api') OR hasPackage('@luckystack/core')
//? at the config-composition layer.

import type { EslintRule } from '../internal/ruleTypes.js';

interface AstNodeShape {
  type?: string;
  value?: unknown;
  quasis?: { value?: { raw?: string; cooked?: string } }[];
}

const extractStaticUrlText = (urlNode: unknown): string | null => {
  if (!urlNode || typeof urlNode !== 'object') return null;
  const n = urlNode as AstNodeShape;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && Array.isArray(n.quasis)) {
    return n.quasis.map((q) => q.value?.cooked ?? q.value?.raw ?? '').join('|');
  }
  return null;
};

const targetsFrameworkRoute = (urlNode: unknown): boolean => {
  const text = extractStaticUrlText(urlNode);
  if (text === null) return false;
  if (/^(https?:)?\/\//.test(text)) return false;
  //? Skip only when the path STARTS with `/auth/` (framework's special
  //? endpoints). The leading `|` accounts for `extractStaticUrlText`'s
  //? template-literal join when the first quasi is empty, e.g.
  //? `${backendUrl}/auth/api/credentials` joins to `|/auth/api/credentials`.
  if (/^(?:\|)?\/auth\//.test(text)) return false;
  return /(?:^|[^A-Za-z])\/(?:api|sync)\//.test(text);
};

const rule: EslintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw `fetch(...)` to framework `/api/*` and `/sync/*` routes. Use `apiRequest` / `syncRequest` instead.',
    },
    messages: {
      useApiRequest:
        'Do not call `fetch` directly for framework `/api/*` routes. Use `apiRequest({ name, version, data })` for typed inference, or `httpFetch(...)` from `@luckystack/core` if you need a raw same-origin request.',
      useSyncRequest:
        'Do not call `fetch` directly for framework `/sync/*` routes. Use `syncRequest({ name, version, data, receiver })` instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        const isFetchCall =
          (callee.type === 'Identifier' && callee.name === 'fetch') ||
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'window' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'fetch');
        if (!isFetchCall) return;
        const url = node.arguments[0];
        if (!targetsFrameworkRoute(url)) return;
        const text = extractStaticUrlText(url) ?? '';
        const messageId = text.includes('/sync/') ? 'useSyncRequest' : 'useApiRequest';
        context.report({ node, messageId });
      },
    };
  },
};

export default rule;
