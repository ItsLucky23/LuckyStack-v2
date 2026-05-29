//? Default-re-export of the canonical `tryCatch` from @luckystack/core.
//? See `shared/sleep.ts` for the rationale behind the `as default` alias.
//?
//? Imported via direct file path (NOT the `@luckystack/core` barrel) so
//? client-side importers (e.g. LoginForm) don't drag the server barrel —
//? and its transitive `bootUuid` → `node:crypto` chain — into a Vite
//? browser bundle. Same pattern as the other `shared/*.ts` shims.
export { default as default } from '../packages/core/src/tryCatch';
