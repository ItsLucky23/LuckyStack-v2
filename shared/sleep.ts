//? Default-re-export of the canonical `sleep` from @luckystack/core. The
//? `as default` aliasing keeps the file's only export named `default` so
//? the function-injection codegen aliases it to the filename — handlers
//? see `functions.sleep.sleep(ms)` instead of `functions.sleep.default(ms)`.
//? Imported via direct file path (NOT the `@luckystack/core` barrel) so
//? client-side importers don't drag the server barrel — and its transitive
//? `bootUuid` → `node:crypto` chain — into a Vite browser bundle. Same
//? pattern as the other `shared/*.ts` shims.
export { default as default } from '../packages/core/src/sleep';
