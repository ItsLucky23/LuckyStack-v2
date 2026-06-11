import { Socket } from "socket.io-client";
import { getProjectConfig } from "./projectConfig";
import { getLogger } from "./loggerRegistry";
import tryCatchSync from "./tryCatchSync";

interface ApiQueueItem {
  id: string;
  key: string;
  run: (socketInstance: Socket) => void;
  createdAt: number;
  /**
   * Per-request override of `projectConfig.offlineQueue.dropPolicy`. See
   * `SyncQueueItem.dropPolicy` for details.
   */
  dropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
}

interface SyncQueueItem {
  id: string;
  key: string;
  run: (socketInstance: Socket) => void;
  createdAt: number;
  /**
   * Per-request override of `projectConfig.offlineQueue.dropPolicy`. Lets a
   * specific sync ("editor cursor move") pick `'drop-oldest'` while the app
   * default stays `'reject'` for safer sends. When omitted, falls back to
   * the global config.
   */
  dropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
}

const apiQueue: ApiQueueItem[] = [];
const syncQueue: SyncQueueItem[] = [];

//? Independent flush guards so a long api flush doesn't no-op a concurrent
//? sync flush (or vice versa).
let isFlushingApi = false;
let isFlushingSync = false;

export const isOnline = () => {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
};

const evictExpired = (queue: { createdAt: number }[]): void => {
  const maxAgeMs = getProjectConfig().offlineQueue.maxAgeMs;
  if (maxAgeMs <= 0) return;
  const cutoff = Date.now() - maxAgeMs;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const item = queue[i];
    if (item && item.createdAt < cutoff) {
      queue.splice(i, 1);
    }
  }
};

const enqueueWithPolicy = <T extends { createdAt: number; dropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject' }>(
  queue: T[],
  item: T,
  label: string,
): boolean => {
  evictExpired(queue);
  const { maxSize, dropPolicy: globalPolicy } = getProjectConfig().offlineQueue;
  //? Per-request override wins over the global policy. Lets specific
  //? syncs pick 'drop-oldest' for liveness while the app default stays
  //? 'reject' for safer sends.
  const effectivePolicy = item.dropPolicy ?? globalPolicy;
  if (queue.length < maxSize) {
    queue.push(item);
    return true;
  }
  if (effectivePolicy === 'drop-oldest') {
    queue.shift();
    queue.push(item);
    getLogger().debug(`offlineQueue:${label} full — dropped oldest item (policy=${effectivePolicy})`);
    return true;
  }
  if (effectivePolicy === 'drop-newest') {
    getLogger().debug(`offlineQueue:${label} full — dropped newest item (policy=${effectivePolicy})`);
    return false;
  }
  getLogger().warn(`offlineQueue:${label} full — rejecting enqueue (policy=${effectivePolicy})`);
  return false;
};

export const enqueueApiRequest = (item: ApiQueueItem): boolean =>
  enqueueWithPolicy(apiQueue, item, 'api');

export const enqueueSyncRequest = (item: SyncQueueItem): boolean =>
  enqueueWithPolicy(syncQueue, item, 'sync');

export const removeApiQueueItem = (id: string) => {
  const index = apiQueue.findIndex((item) => item.id === id);
  if (index !== -1) {
    apiQueue.splice(index, 1);
  }
};

export const removeSyncQueueItem = (id: string) => {
  const index = syncQueue.findIndex((item) => item.id === id);
  if (index !== -1) {
    syncQueue.splice(index, 1);
  }
};

export const removeApiQueueItemsByKey = (key: string) => {
  for (let i = apiQueue.length - 1; i >= 0; i -= 1) {
    if (apiQueue[i]?.key === key) {
      apiQueue.splice(i, 1);
    }
  }
};

//? Run one dequeued item. If `run` throws, requeue it at the FRONT (so the
//? next flush retries it in order) and signal the caller to stop this flush —
//? otherwise a throwing item is silently lost AND the `isFlushing*` guard
//? would be left stuck `true`, wedging every future flush.
const runQueueItem = <T extends { run: (s: Socket) => void }>(
  queue: T[],
  item: T,
  socketInstance: Socket,
  label: string,
): boolean => {
  const [error] = tryCatchSync(() => { item.run(socketInstance); });
  if (error) {
    queue.unshift(item);
    getLogger().warn(`offlineQueue:${label} run threw — requeued item, pausing flush`, { error });
    return false;
  }
  return true;
};

export const flushApiQueue = (canRun: () => boolean, socketInstance: Socket) => {
  if (isFlushingApi) return;
  evictExpired(apiQueue);
  if (apiQueue.length === 0) return;
  if (!canRun()) return;

  isFlushingApi = true;
  while (apiQueue.length > 0) {
    if (!canRun()) break;
    const item = apiQueue.shift();
    if (item && !runQueueItem(apiQueue, item, socketInstance, 'api')) break;
  }
  isFlushingApi = false;
};

export const flushSyncQueue = (canRun: () => boolean, socketInstance: Socket) => {
  if (isFlushingSync) return;
  evictExpired(syncQueue);
  if (syncQueue.length === 0) return;
  if (!canRun()) return;

  isFlushingSync = true;
  while (syncQueue.length > 0) {
    if (!canRun()) break;
    const item = syncQueue.shift();
    if (item && !runQueueItem(syncQueue, item, socketInstance, 'sync')) break;
  }
  isFlushingSync = false;
};

export const getApiQueueSize = () => apiQueue.length;
export const getSyncQueueSize = () => syncQueue.length;
