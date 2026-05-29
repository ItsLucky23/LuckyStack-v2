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
import reactX from 'eslint-plugin-react-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import eslintPluginImportX from 'eslint-plugin-import-x'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import i18next from 'eslint-plugin-i18next';
import eslintPluginComments from 'eslint-plugin-eslint-comments';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      js.configs.recommended,
      tseslint.configs.recommended,
      reactX.configs.recommended,
      eslintPluginUnicorn.configs['flat/recommended'],
      eslintPluginImportX.flatConfigs.recommended,
      eslintPluginImportX.flatConfigs.typescript,
      jsxA11y.flatConfigs.recommended,
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
      'react': react,
      'i18next': i18next,
      'eslint-comments': eslintPluginComments
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'eslint-comments/no-unused-disable': 'error',
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
      "react/jsx-no-literals": ["warn", {
        "noStrings": true,
        "allowedStrings": [
          // Original & Punctuation
          "!", "?", "-", "/", ":", ",", "(", ")", "%", "&",
          "@", "#", "$", "^", "*", "+", "=", "|", ".", "...",

          // Commonly used single-character literals
          "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",

          // UI Dividers & Whitespace placeholders
          " ", " ", " | ", " • ", " » ", " « ", "—", "–",

          // Common Logic/Unit symbols
          "x", "px", "rem", "em", "ms", "s", "°"
        ],
        "ignoreProps": true
      }],
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
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
  //? per CLAUDE.md rule 8 installs require explicit approval.
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
      'react/jsx-no-literals': 'off',
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
  }
)
