//? Official-plugins tier of the lint contract. Mirrors the React +
//? TypeScript + import + a11y plugins the framework has always used.
//? Framework-specific rules live in `eslint.luckystack.config.js`.
//?
//? Both files are spread by `eslint.config.js` (the entry).

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
//? react-x was out of this config from June 2026: its ESLint-9 line capped
//? `typescript` at 5.x. 5.x accepts any ESLint and TypeScript, so it is back,
//? matching the scaffold template.
import reactX from 'eslint-plugin-react-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import eslintPluginImportX from 'eslint-plugin-import-x'
//? The maintained fork of eslint-plugin-jsx-a11y (same recommended set); the
//? original stopped at ESLint 9. Rule ids are `jsx-a11y-x/…`.
import jsxA11y from 'eslint-plugin-jsx-a11y-x'
import i18next from 'eslint-plugin-i18next';

//? Unicorn rules this project has adopted. Between v64 and v78 unicorn's
//? recommended preset grew from 137 to 338 rules; enabling them all at once
//? meant ~2,900 new findings here and in every upgraded app, mostly naming and
//? comment style. A rule unicorn adds later therefore stays off until someone
//? adopts it on purpose: add its name here and fix what it reports.
//? `prefer-ternary`, `prefer-simple-condition-first`, `prefer-default-parameters`
//? and `prefer-logical-operator-over-ternary` were adopted before v66 but now
//? flag ~290 style-only sites, so they are left out until re-adopted.
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
  { ignores: ['dist'] },
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
        project: [
          './tsconfig.json',
          './tsconfig.client.json',
          './tsconfig.server.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.json', './tsconfig.client.json', './tsconfig.server.json'],
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
      //? react-hooks 7's `recommended` preset now bundles the new React-Compiler-
      //? adjacent rules (e.g. `react-hooks/set-state-in-effect`) which flag ~25
      //? existing effect sites. Adopting those is a deliberate refactor, not a
      //? dep-bump side effect — pin to the classic pair for now. Drop these two
      //? lines back to `...reactHooks.configs.recommended.rules` when you want to
      //? take on the React-Compiler lint migration.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          //? Framework convention: `page.tsx` co-exports `template` and
          //? `middleware` alongside the default component. Both are static
          //? config consumed by `TemplateProvider` + `<Middleware>` — they
          //? do not break Fast Refresh in practice. Whitelist the names
          //? so the per-page pattern doesn't generate noise.
          allowExportNames: ['template', 'middleware'],
        },
      ],
      'unicorn/filename-case': "off",
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import-x/order': 'off',
      //? Untranslated JSX text is `luckystack/no-untranslated-jsx-text`
      //? (eslint.luckystack.config.js), with the same punctuation allow-list.
      'jsx-a11y-x/click-events-have-key-events': 'off',
      'jsx-a11y-x/no-static-element-interactions': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAsExpression > Identifier[name=/^(serverOutput|clientOutput|response|result|output|res)$/]",
          message: 'Do not use double-casts on backend payloads. Use generated types from src/_sockets/apiTypes.generated.ts and discriminated unions instead.',
        },
        {
          selector: 'TSAsExpression > TSAsExpression > TSUnknownKeyword',
          message: 'Vermijd de double-cast `x as unknown as Y` — dat omzeilt de type-checker. Gebruik een runtime-guard of een typed boundary-helper (zie shared/prismaJson.ts).',
        },
      ],
      //? Type-safety hardening — keeps the typed API/sync contract honest
      //? (no `any`, no unsafe `as`, no object-literal type assertions).
      //? `no-non-null-assertion` is intentionally a warn so legitimate `!`
      //? uses in framework boundary code surface without breaking the build.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
      }],
      //? `_`-prefixed names are the well-known convention for "intentionally
      //? unused" identifiers. Without these ignore patterns, every signature
      //? that documents an unused param via a leading underscore trips the
      //? rule.
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  //? Server-side overlay. Applies to first-party server/shared/scripts/config
  //? AND to framework packages under `packages/*/src/` so server-only
  //? relaxations (template-expression flex, ts-comment escape hatch) flow
  //? to handler code regardless of where it lives.
  //?
  //? Critical async-correctness rules (`@typescript-eslint/no-floating-promises`,
  //? `@typescript-eslint/no-misused-promises`) come from
  //? `tseslint.configs.strictTypeChecked` in the global `**/*.{ts,tsx}` block
  //? above — they ARE active for server code without needing to repeat them
  //? here. Don't add `eslint-plugin-n` without an `npm install` discussion;
  //? per AGENTS.md installs require explicit approval.
  {
    files: [
      'server/**/*.ts',
      'shared/**/*.ts',
      'scripts/**/*.ts',
      'config.ts',
      'packages/*/src/**/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'import-x/default': 'off',
      //? `no-non-null-assertion: 'off'` overlay REMOVED per the strict-typing
      //? policy — server/shared/scripts/config.ts now obey the same rule the
      //? rest of the codebase does. Legitimate `!` uses surface as warnings
      //? so reviewers see them; structurally-impossible cases get an inline
      //? `// eslint-disable-next-line` with a WHY comment.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
  {
    files: [
      'src/**/*api/**/*.ts',
      'src/**/*Api/**/*.ts',
      'src/**/*sync/**/*.ts',
      'src/**/*Sync/**/*.ts'
    ],
    rules: {
      // '@typescript-eslint/no-unused-vars': 'off',
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
