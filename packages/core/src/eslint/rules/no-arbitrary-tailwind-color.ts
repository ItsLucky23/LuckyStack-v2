//? Rule: warn on arbitrary Tailwind color values (`text-[#fff]`,
//? `bg-[#abc123]`, `border-[#000]`) inside className strings. The framework
//? mandates colors from `src/index.css` `@theme` block (rule 14). Arbitrary
//? colors break dark-mode auto-switching.

//? Double-cast disabled file-wide: this rule operates on AST nodes that span
//? two type universes (eslint's `Rule.Node` vs the JSX-extended shape from
//? eslint-plugin-react). Bridging them needs `as unknown as`; runtime
//? guards happen via explicit `.type === 'JSXIdentifier'` checks above each
//? cast.
/* eslint-disable no-restricted-syntax */

import type { Rule } from 'eslint';

import type { EslintRule } from '../internal/ruleTypes.js';

const ARBITRARY_COLOR_PATTERN = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|accent|caret|placeholder|divide)-\[#[0-9a-fA-F]{3,8}\]/;

//? JSX AST nodes (JSXAttribute, JSXExpressionContainer, …) are not part of
//? eslint's stock estree AST. eslint-plugin-react extends the visitor map at
//? runtime, but the stock `Rule.RuleListener` type does not know about them,
//? so we describe the shapes we read inline. The actual eslint runtime gives
//? us the right object; this is purely a TS-side annotation.
type ClassNameValueShape =
  | { type: 'Literal'; value: unknown }
  | { type: 'JSXExpressionContainer'; expression: ExpressionShape }
  | { type: string };

type ExpressionShape =
  | { type: 'Literal'; value: unknown }
  | { type: 'TemplateLiteral'; quasis: readonly { value: { cooked?: string; raw: string } }[] }
  | { type: string };

interface JsxAttributeShape {
  name: { type: string; name?: string };
  value?: ClassNameValueShape | null;
}

const reportIfArbitrary = (
  context: Rule.RuleContext,
  node: Rule.Node,
  value: string,
): void => {
  if (ARBITRARY_COLOR_PATTERN.test(value)) {
    context.report({ node, messageId: 'useThemeToken' });
  }
};

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow arbitrary Tailwind color values (`text-[#…]`, `bg-[#…]`, …). Use tokens from `src/index.css` `@theme` block.',
    },
    messages: {
      useThemeToken:
        'Do not use arbitrary Tailwind color values like `text-[#…]`. Use a token from `src/index.css` `@theme` block (e.g. `bg-primary`, `text-title`, `border-divider`). Arbitrary colors break dark-mode auto-switching.',
    },
    schema: [],
  },
  create(context) {
    const listener: Rule.RuleListener = {
      JSXAttribute(rawNode: unknown): void {
        const node = rawNode as JsxAttributeShape & Rule.Node;
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'className') return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'Literal' && typeof (value as { value?: unknown }).value === 'string') {
          reportIfArbitrary(context, value as unknown as Rule.Node, (value as { value: string }).value);
          return;
        }
        if (value.type === 'JSXExpressionContainer') {
          const expression = (value as { expression: ExpressionShape }).expression;
          if (expression.type === 'TemplateLiteral') {
            const quasis = (expression as { quasis: readonly { value: { cooked?: string; raw: string } }[] }).quasis;
            for (const quasi of quasis) {
              reportIfArbitrary(
                context,
                quasi as unknown as Rule.Node,
                quasi.value.cooked ?? quasi.value.raw,
              );
            }
          } else if (expression.type === 'Literal' && typeof (expression as { value?: unknown }).value === 'string') {
            reportIfArbitrary(
              context,
              expression as unknown as Rule.Node,
              (expression as { value: string }).value,
            );
          }
        }
      },
    };
    return listener;
  },
};

export default rule;
