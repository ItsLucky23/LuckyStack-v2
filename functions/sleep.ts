//? Small utility — pauses async flow without depending on any package. Shows up
//? as `functions.sleep.sleep(ms)` inside every API + sync handler. Useful for
//? testing rate-limit code paths, simulating slow upstreams, or staggering
//? bulk operations.
//?
//? Edit freely. Framework-internal code does not consume `functions.sleep`.
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
