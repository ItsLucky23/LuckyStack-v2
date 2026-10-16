//? Official-plugins tier of the lint contract. Mirrors the React +
//? TypeScript + import + a11y plugins the LuckyStack framework uses.
//? Framework-specific rules live in `eslint.luckystack.config.js`.
//?
//? Both files are spread by `eslint.config.js` (the entry point).

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import eslintPluginImportX from 'eslint-plugin-import-x'
//? The maintained fork of eslint-plugin-jsx-a11y (same recommended set); the
//? original stopped at ESLint 9. Rule ids are `jsx-a11y-x/…`.
import jsxA11y from 'eslint-plugin-jsx-a11y-x'
import i18next from 'eslint-plugin-i18next'

//? Unicorn rules this project has adopted. Between v64 and v78 unicorn's
//? recommended preset grew from 137 to 338 rules; enabling them all at once
//? meant thousands of new findings in every upgraded app, mostly naming and
//? comment style. A rule unicorn adds later therefore stays off until someone
//? adopts it on purpose: add its name here and fix what it reports.
//? `prefer-ternary`, `prefer-simple-condition-first`, `prefer-default-parameters`
//? and `prefer-logical-operator-over-ternary` were adopted before v66 but now
//? flag many style-only sites, so they are left out until re-adopted.
const ADOPTED_UNICORN_RULES = new Set([
  'catch-error-name', 'consistent-assert', 'consistent-date-clone',
  'consistent-empty-array-spread', 'consistent-existence-index-check',
  'consistent-function-scoping', 'consistent-template-literal-escape',
  'empty-brace-spaces', 'error-message', 'escape-case',
  'expiring-todo-comments', 'explicit-length-check', 'filename-case',
  'import-style', 'isolated-functions', 'new-for-builtins',
  'no-abusive-eslint-disable', 'no-accessor-recursion',
  'no-anonymous-default-export', 'no-array-callback-reference',
  'no-array-method-this-argument', 'no-array-reduce',
  'no-array-reverse', 'no-array-sort', 'no-await-expression-member',
  'no-await-in-promise-methods', 'no-console-spaces', 'no-document-cookie',
  'no-empty-file', 'no-for-loop', 'no-immediate-mutation',
  'no-instanceof-builtins', 'no-invalid-fetch-options',
  'no-invalid-remove-event-listener', 'no-lonely-if',
  'no-magic-array-flat-depth', 'no-named-default', 'no-negated-condition',
  'no-negation-in-equality-check', 'no-nested-ternary', 'no-new-array',
  'no-new-buffer', 'no-null', 'no-object-as-default-parameter',
  'no-process-exit', 'no-single-promise-in-promise-methods',
  'no-static-only-class', 'no-thenable', 'no-this-assignment',
  'no-typeof-undefined', 'no-unnecessary-array-flat-depth',
  'no-unnecessary-array-splice-count', 'no-unnecessary-await',
  'no-unnecessary-polyfills', 'no-unnecessary-slice-end',
  'no-unreadable-array-destructuring', 'no-unreadable-iife',
  'no-unsafe-string-replacement', 'no-useless-collection-argument',
  'no-useless-error-capture-stack-trace', 'no-useless-fallback-in-spread',
  'no-useless-iterator-to-array', 'no-useless-length-check',
  'no-useless-promise-resolve-reject', 'no-useless-spread',
  'no-useless-switch-case', 'no-useless-undefined', 'no-zero-fractions',
  'number-literal-case', 'numeric-separators-style',
  'prefer-add-event-listener', 'prefer-array-find', 'prefer-array-flat',
  'prefer-array-flat-map', 'prefer-array-index-of', 'prefer-array-some',
  'prefer-at', 'prefer-bigint-literals', 'prefer-blob-reading-methods',
  'prefer-class-fields', 'prefer-classlist-toggle', 'prefer-code-point',
  'prefer-date-now', 'prefer-dom-node-append',
  'prefer-dom-node-remove', 'prefer-dom-node-text-content',
  'prefer-event-target', 'prefer-export-from', 'prefer-global-this',
  'prefer-includes', 'prefer-keyboard-event-key', 'prefer-math-min-max',
  'prefer-math-trunc', 'prefer-modern-dom-apis', 'prefer-modern-math-apis',
  'prefer-module', 'prefer-native-coercion-functions', 'prefer-negative-index',
  'prefer-node-protocol', 'prefer-number-properties',
  'prefer-object-from-entries', 'prefer-optional-catch-binding',
  'prefer-prototype-methods', 'prefer-query-selector', 'prefer-reflect-apply',
  'prefer-regexp-test', 'prefer-response-static-json', 'prefer-set-has',
  'prefer-set-size', 'prefer-single-call',
  'prefer-spread', 'prefer-string-raw', 'prefer-string-replace-all',
  'prefer-string-slice', 'prefer-string-starts-ends-with',
  'prefer-string-trim-start-end', 'prefer-structured-clone', 'prefer-switch',
  'prefer-top-level-await', 'prefer-type-error',
  'relative-url-style', 'require-array-join-separator',
  'require-module-attributes', 'require-module-specifiers',
  'require-number-to-fixed-digits-argument', 'switch-case-braces',
  'switch-case-break-position', 'template-indent',
  'text-encoding-identifier-case', 'throw-new-error',
])
const unadoptedUnicornRules = Object.fromEntries(
  Object.keys(eslintPluginUnicorn.configs.recommended.rules)
    .filter((id) => !ADOPTED_UNICORN_RULES.has(id.replace('unicorn/', '')))
    .map((id) => [id, 'off']),
)

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '**/*.generated.*'] },
  {
    files: ['**/*.{ts,tsx}'],
    //? A disable that no longer suppresses anything fails the lint, so
    //? disables cannot rot silently.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      js.configs.recommended,
      tseslint.configs.recommended,
      reactX.configs.recommended,
      eslintPluginUnicorn.configs.recommended,
      eslintPluginImportX.flatConfigs.recommended,
      eslintPluginImportX.flatConfigs.typescript,
      jsxA11y.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.json', './tsconfig.server.json'],
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'i18next': i18next,
    },
    rules: {
      ...unadoptedUnicornRules,
      //? react-hooks 7's `recommended` preset also bundles the React-Compiler
      //? rules (e.g. `react-hooks/set-state-in-effect`). Adopting those is a
      //? deliberate refactor, so this stays on the classic pair; switch to
      //? `...reactHooks.configs.recommended.rules` to take them on.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          //? Framework convention: page.tsx co-exports `template` +
          //? `middleware` alongside the default component. Whitelist both.
          allowExportNames: ['template', 'middleware'],
        },
      ],
      'unicorn/filename-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'jsx-a11y-x/click-events-have-key-events': 'off',
      'jsx-a11y-x/no-static-element-interactions': 'off',
      //? Untranslated JSX text is `luckystack/no-untranslated-jsx-text`
      //? (eslint.luckystack.config.js).
      //? Strict typing — no any, no double-cast, no object-literal as-cast.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
      }],
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression > TSAsExpression > TSUnknownKeyword',
        message: 'Avoid double-cast `x as unknown as Y` — it bypasses the type-checker. Use a runtime guard or typed boundary helper instead.',
      }],
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts', 'config.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'import-x/default': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
  {
    //? A route with no input or output yet declares its shape as `{}`; the
    //? type generator reads that literal and the dev tooling rewrites it when
    //? a sync gains or loses its server file. Empty interfaces stay flagged.
    files: ['src/**/_api/**/*.ts', 'src/**/_sync/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
    },
  },
)
