//? Public entry for `@luckystack/core/eslint`. Composes the LuckyStack
//? flat-config tier that the scaffolded `eslint.luckystack.config.js`
//? consumes. Rules that target an optional `@luckystack/*` peer package
//? are gated via `hasPackage(...)` so absent peers cause silent rule
//? skips (NOT noisy "rule not found" errors).
//?
//? Override surface: consumers can spread this default export and append
//? their own config blocks, or replace individual rule severities by
//? re-stating them with `'off' | 'warn' | 'error'`.

import type { Linter } from 'eslint';

import { hasPackage } from './internal/hasPackage.js';
import type { EslintRule } from './internal/ruleTypes.js';

import noArbitraryTailwindColor from './rules/no-arbitrary-tailwind-color.js';
import noDirectPrismaImportInComponents from './rules/no-direct-prisma-import-in-components.js';
import noRawFetchInSrc from './rules/no-raw-fetch-in-src.js';
import noRawTryCatch from './rules/no-raw-try-catch.js';
import noUnsafeApiWrappers from './rules/no-unsafe-api-wrappers.js';
import noUnsafeSyncWrappers from './rules/no-unsafe-sync-wrappers.js';
import preferLuckystackConfirm from './rules/prefer-luckystack-confirm.js';
import preferLuckystackDropdown from './rules/prefer-luckystack-dropdown.js';
import preferLuckystackNotify from './rules/prefer-luckystack-notify.js';

const allRules: Record<string, EslintRule> = {
  'no-raw-try-catch': noRawTryCatch,
  'no-raw-fetch-in-src': noRawFetchInSrc,
  'no-unsafe-api-wrappers': noUnsafeApiWrappers,
  'no-unsafe-sync-wrappers': noUnsafeSyncWrappers,
  'prefer-luckystack-dropdown': preferLuckystackDropdown,
  'prefer-luckystack-confirm': preferLuckystackConfirm,
  'prefer-luckystack-notify': preferLuckystackNotify,
  'no-direct-prisma-import-in-components': noDirectPrismaImportInComponents,
  'no-arbitrary-tailwind-color': noArbitraryTailwindColor,
};

const hasApi = hasPackage('@luckystack/api');
const hasCore = hasPackage('@luckystack/core');
const hasSync = hasPackage('@luckystack/sync');

const ruleSeverities: Record<string, Linter.RuleSeverity> = {
  // Always-on errors.
  'luckystack/no-raw-try-catch': 'error',

  // Package-gated errors. Disabled when the relevant peer is absent so
  // a consumer using only @luckystack/core sees no "use apiRequest" noise.
  'luckystack/no-raw-fetch-in-src': hasApi || hasCore ? 'error' : 'off',
  'luckystack/no-unsafe-api-wrappers': hasApi ? 'error' : 'off',
  'luckystack/no-unsafe-sync-wrappers': hasSync ? 'error' : 'off',

  // Warnings — enabled by default per framework owner's preference.
  'luckystack/prefer-luckystack-dropdown': 'warn',
  'luckystack/prefer-luckystack-confirm': 'warn',
  'luckystack/prefer-luckystack-notify': 'warn',
  'luckystack/no-direct-prisma-import-in-components': 'warn',
  'luckystack/no-arbitrary-tailwind-color': 'warn',
};

const luckystackConfig: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: {
      luckystack: { rules: allRules as Record<string, EslintRule> },
    },
    rules: ruleSeverities,
  },
];

export default luckystackConfig;

//? Named exports for advanced consumers who want to assemble their own
//? config or selectively re-enable individual rules.
export { allRules as rules };
export { hasPackage };
