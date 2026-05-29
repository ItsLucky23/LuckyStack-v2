//? Cross-handler in-flight-request registry. Maps a stable key
//? (`socketId:cb` for sync, `socketId:responseIndex` for api) to the
//? `AbortController` driving the request's handler chain. The `apiCancel`
//? / `syncCancel` socket event handlers look up the controller and call
//? `.abort()` so the in-flight handler can stop emitting new chunks and
//? exit early. Also walked on socket `disconnect` to abort everything
//? still in flight for that socket.
//?
//? Lives in `@luckystack/core` (not `@luckystack/api` or `@luckystack/sync`)
//? because the cancel-event listener is registered in `@luckystack/server`'s
//? `loadSocket.ts`, which sits below both handler packages in the dep graph.
//?
//? Stored as plain Map (not WeakMap) because lookup is by string key and
//? entries are explicitly removed at request end + on `disconnect`. Memory
//? leak risk is bounded — handlers always call `unregister*` in their
//? cleanup paths and disconnect drains everything for the closing socket.

const syncControllers = new Map<string, AbortController>();
const apiControllers = new Map<string, AbortController>();

const buildKey = (socketId: string, identifier: string | number): string =>
  `${socketId}:${String(identifier)}`;

export const registerSyncAbortController = (
  socketId: string,
  cb: string,
  controller: AbortController,
): string => {
  const key = buildKey(socketId, cb);
  syncControllers.set(key, controller);
  return key;
};

export const unregisterSyncAbortController = (key: string): void => {
  syncControllers.delete(key);
};

export const abortSyncByCb = (socketId: string, cb: string): boolean => {
  const key = buildKey(socketId, cb);
  const controller = syncControllers.get(key);
  if (!controller) return false;
  controller.abort();
  syncControllers.delete(key);
  return true;
};

export const registerApiAbortController = (
  socketId: string,
  responseIndex: number | string,
  controller: AbortController,
): string => {
  const key = buildKey(socketId, responseIndex);
  apiControllers.set(key, controller);
  return key;
};

export const unregisterApiAbortController = (key: string): void => {
  apiControllers.delete(key);
};

export const abortApiByResponseIndex = (
  socketId: string,
  responseIndex: number | string,
): boolean => {
  const key = buildKey(socketId, responseIndex);
  const controller = apiControllers.get(key);
  if (!controller) return false;
  controller.abort();
  apiControllers.delete(key);
  return true;
};

//? Drain everything in-flight for a socket — called on `disconnect`.
//? Linear scan over both registries; disconnect is rare relative to
//? regular request volume, and the registries are bounded by per-socket
//? in-flight request count (typically <10).
export const abortAllForSocket = (socketId: string): void => {
  const prefix = `${socketId}:`;
  for (const [key, controller] of syncControllers) {
    if (key.startsWith(prefix)) {
      controller.abort();
      syncControllers.delete(key);
    }
  }
  for (const [key, controller] of apiControllers) {
    if (key.startsWith(prefix)) {
      controller.abort();
      apiControllers.delete(key);
    }
  }
};
