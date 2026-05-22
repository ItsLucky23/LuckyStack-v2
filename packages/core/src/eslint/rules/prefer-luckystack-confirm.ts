//? Rule: warn on `confirm(...)` / `window.confirm(...)` calls. The framework
//? provides `menuHandler.confirm({ title, content, input? })` from
//? `src/_functions/menuHandler.ts` which renders a styled, theme-aware,
//? Promise-returning confirm dialog and respects keyboard / accessibility.

import type { EslintRule } from '../internal/ruleTypes.js';

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer `menuHandler.confirm({ title, content })` over the native `confirm()` dialog.',
    },
    messages: {
      useMenuHandlerConfirm:
        'Use `menuHandler.confirm({ title, content })` from `src/_functions/menuHandler.ts` instead of native `confirm()`. Returns a `Promise<boolean>` with proper theming.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'confirm') {
          context.report({ node, messageId: 'useMenuHandlerConfirm' });
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'window' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'confirm'
        ) {
          context.report({ node, messageId: 'useMenuHandlerConfirm' });
        }
      },
    };
  },
};

export default rule;
