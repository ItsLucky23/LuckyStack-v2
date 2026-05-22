//? Rule: warn on `alert(...)` / `window.alert(...)`. The framework's
//? `notify` helper (from @luckystack/core) renders themed toast
//? notifications via the registered notifier (default sonner).

import type { EslintRule } from '../internal/ruleTypes.js';

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer `notify()` over the native `alert()` dialog.',
    },
    messages: {
      useNotify:
        'Use `notify({ type, message })` from `@luckystack/core` instead of native `alert()`. Renders a themed toast via the registered notifier.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'alert') {
          context.report({ node, messageId: 'useNotify' });
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'window' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'alert'
        ) {
          context.report({ node, messageId: 'useNotify' });
        }
      },
    };
  },
};

export default rule;
