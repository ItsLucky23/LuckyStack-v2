//? Default-re-export of the canonical `sleep` from @luckystack/core. The
//? `as default` aliasing keeps the file's only export named `default` so
//? the function-injection codegen aliases it to the filename — handlers
//? see `functions.sleep.sleep(ms)` instead of `functions.sleep.default(ms)`.
export { sleep as default } from '@luckystack/core';
