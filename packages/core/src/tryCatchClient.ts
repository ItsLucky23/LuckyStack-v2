//? Browser-safe sibling of `tryCatch`. Behaviourally identical (same tuple,
//? same params, same auto-capture on the error path) but it does NOT statically
//? import `./sentrySetup`. The server `tryCatch.ts` reaches `sentrySetup` →
//? `errorTrackerRegistry` → `node:async_hooks` at module-eval; that static edge
//? is harmless on the server but drags a `node:`-externalized module into the
//? Vite CLIENT bundle whenever a client importer (LoginForm) pulls
//? `shared/tryCatch.ts`. So the client-reachable shim resolves HERE instead, and
//? the only path to capture is a LAZY dynamic import taken on the error branch —
//? keeping the node-bearing module out of the client's static graph.
//?
//? The server's `tryCatch.ts` is intentionally left untouched (byte-for-byte) so
//? the server capture path keeps its synchronous, statically-linked behaviour.
//? On the client, capture is best-effort and async-via-microtask is fine.

export default async function tryCatch<T, P = void>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  context?: Record<string, unknown>
): Promise<[Error | null, T | null]> {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    //? Lazy capture: the import is only evaluated on the error branch, so the
    //? `node:async_hooks`-bearing module never enters the client's static graph.
    const { captureException } = await import('./sentrySetup');
    captureException(error, context);
    return [error as Error, null];
  }
}
