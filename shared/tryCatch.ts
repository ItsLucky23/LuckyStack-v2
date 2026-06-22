//? Default-re-export of the BROWSER-SAFE `tryCatch` from @luckystack/core.
//? See `shared/sleep.ts` for the rationale behind the `as default` alias.
//?
//? Resolves to `tryCatchClient` (NOT the server `tryCatch`) so client-side
//? importers (e.g. LoginForm) don't drag the server `tryCatch` → `sentrySetup`
//? → `errorTrackerRegistry` → `node:async_hooks` chain into the Vite browser
//? bundle as a STATIC edge. The client variant is behaviourally identical but
//? lazy-imports the capture seam on the error branch only. The server keeps its
//? synchronous, statically-linked `tryCatch` (imported via the `@luckystack/core`
//? barrel) untouched. Same shim pattern as the other `shared/*.ts` files.
export { default as default } from '../packages/core/src/tryCatchClient';
