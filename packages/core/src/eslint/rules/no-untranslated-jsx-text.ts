//? Rule: user-facing text in JSX goes through the project's translator
//? (AGENTS.md rule 13). Replaces `react/jsx-no-literals` with the options the
//? framework always ran it with (`noStrings`, `ignoreProps`, a punctuation
//? allow-list): eslint-plugin-react stopped at ESLint 9 and was otherwise only
//? kept for this one rule. Behaviour is a faithful port, so existing disables
//? and expectations carry over unchanged:
//?   - JSX text children and string/template literals that are a child's
//?     `{…}` expression are reported; attribute values (props) are not.
//?   - A string concatenation (`{'a' + b}`) counts as the literal itself;
//?     ternaries and `&&` branches are not inspected.

import type { Rule } from 'eslint';

import type { EslintRule } from '../internal/ruleTypes.js';

//? Characters and units that read the same in every language, so routing them
//? through the translator only adds noise. Compared after trimming.
export const DEFAULT_ALLOWED_JSX_STRINGS: readonly string[] = [
  '!', '?', '-', '/', ':', ',', '(', ')', '%', '&',
  '@', '#', '$', '^', '*', '+', '=', '|', '.', '...',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '•', '»', '«', '—', '–',
  'x', 'px', 'rem', 'em', 'ms', 's', '°',
];

const WHITESPACE_ONLY = /^\s+$/;
const ELEMENT_TYPES = new Set(['JSXElement', 'JSXFragment']);

//? JSX nodes are not part of eslint's estree typings; the parser supplies them
//? at runtime. Describe only what this rule reads.
interface NodeShape {
  type: string;
  parent?: NodeShape | null;
}

interface TextNodeShape extends NodeShape {
  value: unknown;
  raw?: string;
}

const asRuleNode = (node: object): Rule.Node => node as Rule.Node;

//? `'a' + b + 'c'` — climb out of the concatenation so its pieces are judged
//? by where the whole expression sits.
const parentSkippingConcatenation = (node: NodeShape): NodeShape | null => {
  let current = node;
  while (current.parent?.type === 'BinaryExpression') current = current.parent;
  return current.parent ?? null;
};

//? A text child: either directly inside an element/fragment, or the
//? expression of a `{…}` that is itself a child (not an attribute value).
const isChildPosition = (node: NodeShape): boolean => {
  const parent = parentSkippingConcatenation(node);
  if (!parent) return false;
  if (ELEMENT_TYPES.has(parent.type)) return true;
  return parent.type === 'JSXExpressionContainer' && ELEMENT_TYPES.has(parent.parent?.type ?? '');
};

const rule: EslintRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow untranslated text in JSX. User-facing text goes through the project translator.',
    },
    messages: {
      untranslated:
        'Untranslated text in JSX: "{{text}}". Put user-facing text through the project translator (`useTranslator`) so every language gets it.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedStrings: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as { allowedStrings?: readonly string[] };
    const allowed = new Set((options.allowedStrings ?? DEFAULT_ALLOWED_JSX_STRINGS).map((s) => s.trim()));

    const isAllowedText = (node: TextNodeShape): boolean => {
      if (typeof node.value !== 'string' || WHITESPACE_ONLY.test(node.value) || node.value === '') return true;
      return allowed.has(node.value.trim()) || (node.raw !== undefined && allowed.has(node.raw.trim()));
    };

    const report = (node: NodeShape): void => {
      const ruleNode = asRuleNode(node);
      context.report({
        node: ruleNode,
        messageId: 'untranslated',
        data: { text: context.sourceCode.getText(ruleNode).trim() },
      });
    };

    const listener: Rule.RuleListener = {
      JSXText(rawNode: unknown): void {
        const node = rawNode as TextNodeShape;
        if (!isAllowedText(node) && isChildPosition(node)) report(node);
      },
      Literal(rawNode: unknown): void {
        const node = rawNode as TextNodeShape;
        if (!isAllowedText(node) && isChildPosition(node)) report(node);
      },
      TemplateLiteral(rawNode: unknown): void {
        const node = rawNode as NodeShape;
        const parent = parentSkippingConcatenation(node);
        if (parent?.type === 'JSXExpressionContainer' && parent.parent?.type === 'JSXElement') report(node);
      },
    };
    return listener;
  },
};

export default rule;
