//? Entry point for `eslint`. Spreads the two tiers — official plugins +
//? LuckyStack framework rules — so they can be edited and overridden
//? independently. See `eslint.official.config.js` and
//? `eslint.luckystack.config.js`.

import official from './eslint.official.config.js'
import luckystack from './eslint.luckystack.config.js'

export default [
  ...official,
  ...luckystack,
  //? `src/workspaces/**` is the in-repo UI prototype for the Workspaces project
  //? (dummy data, English design copy, moves to its own repo before publish).
  //? Relax the i18n-enforcement + purely-stylistic rules here so the prototype
  //? can iterate fast; the strict config still governs the rest of the repo.
  //? When Workspaces graduates to its own repo these get re-enabled + strings
  //? routed through `useTranslator`.
  {
    files: ['src/workspaces/**/*.{ts,tsx}'],
    rules: {
      'react/jsx-no-literals': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/consistent-function-scoping': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      //? Dummy seed arrays are indexed with `!` and primitives.tsx is a shared
      //? module exporting helpers alongside components — both fine for the kit.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
]
//npx eslint src/**/*.tsx

