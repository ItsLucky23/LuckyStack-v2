//? Minimal local type aliases for eslint rule definitions so this package
//? does not take a hard dependency on @typescript-eslint/utils. Consumers
//? bring eslint themselves as a peer; we only need the shapes.

import type { Rule } from 'eslint';

export type EslintRule = Rule.RuleModule;
export type RuleContext = Rule.RuleContext;
export type RuleListener = Rule.RuleListener;
