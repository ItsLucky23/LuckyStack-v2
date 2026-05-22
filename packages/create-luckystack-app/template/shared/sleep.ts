//? Re-export the canonical `sleep` helper from @luckystack/core so it
//? shows up as `functions.sleep.sleep(ms)` inside every API + sync
//? handler. The codegen aliases the `default` re-export to the filename,
//? hence the `as default` syntax.
//?
//? Lives in `shared/` (not `functions/`) so the framework can later swap
//? the implementation without you needing to update your project's
//? `functions/` shim layer.
export { sleep as default, sleep } from '@luckystack/core';
