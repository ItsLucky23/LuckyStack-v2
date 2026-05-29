//? Rule: warn when a JSX `<select>` element is used. The framework ships
//? `Dropdown` (src/_components/Dropdown.tsx) with search, keyboard nav,
//? sizing variants, and consistent dark/light styling. Native `<select>`
//? skips all of that.

import type { Rule } from 'eslint';

import type { EslintRule } from '../internal/ruleTypes.js';

//? JSX AST nodes are extended at runtime by eslint-plugin-react, but
//? eslint's stock `Rule.RuleListener` type does not know about them. We
//? describe the shapes we read inline.
interface JsxOpeningElementShape {
  name: { type: string; name?: string };
}

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer the framework `Dropdown` component over native `<select>` elements.',
    },
    messages: {
      useDropdown:
        'Use `Dropdown` from `src/_components/Dropdown.tsx` (or `MultiSelectDropdown` for multi-select) instead of native `<select>`. The framework component handles keyboard nav, search, sizing, and dark/light theme.',
    },
    schema: [],
  },
  create(context) {
    const listener: Rule.RuleListener = {
      JSXOpeningElement(rawNode: unknown): void {
        const node = rawNode as JsxOpeningElementShape & Rule.Node;
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'select') {
          context.report({ node, messageId: 'useDropdown' });
        }
      },
    };
    return listener;
  },
};

export default rule;
