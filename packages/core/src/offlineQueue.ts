import { Socket } from "socket.io-client";
import { getProjectConfig } from "./projectConfig";
import { getLogger } from "./loggerRegistry";
import tryCatchSync from "./tryCatchSync";
import { dispatchClientHook } from "./clientHookBus";

/** Why a queued item was dropped (handed to its `onDrop` callback). */
export type QueueDropReason = 'expired' | 'queue-full';

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
  /**
   * Optional callback invoked when THIS item is dropped (evicted for age or
   * because the queue was full / rejected) instead of ever running (SYNC-09).
   * The transport wires this to settle the pending `syncRequest`/`apiRequest`
   * promise with an error envelope, so an evicted offline request resolves
   * rather than hanging forever. Invoked at most once; failures are swallowed.
   */
  onDrop?: (reason: QueueDropReason) => void;
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
  /** See {@link ApiQueueItem.onDrop} (SYNC-09). */
  onDrop?: (reason: QueueDropReason) => void;
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

//? Common drop shape — every queue item the framework drops carries these.
interface DroppableItem {
  createdAt: number;
  key: string;
  dropPolicy?: 'drop-oldest' | 'drop-newest' | 'reject';
  onDrop?: (reason: QueueDropReason) => void;
}

//? Notify a dropped item's owner exactly once. Swallows callback errors so a
//? throwing `onDrop` can't wedge the eviction/enqueue loop (SYNC-09).
const notifyDropped = (item: DroppableItem, reason: QueueDropReason): void => {
  if (!item.onDrop) return;
  tryCatchSync(() => { item.onDrop?.(reason); });
};

//? Dispatch the `queueItemDropped` client hook, guarded so a misbehaving
//? handler set can't interrupt the eviction/enqueue loop (CORE-N8).
const safeDispatchDropHook = (
  queue: 'api' | 'sync',
  key: string,
  reason: QueueDropReason,
  dropPolicy: 'drop-oldest' | 'drop-newest' | 'reject',
): void => {
  tryCatchSync(() => {
    dispatchClientHook('queueItemDropped', { queue, key, reason, dropPolicy });
  });
};

const evictExpired = (
  queue: DroppableItem[],
  label: 'api' | 'sync',
): void => {
  const { maxAgeMs, dropPolicy: globalPolicy } = getProjectConfig().offlineQueue;
  if (maxAgeMs <= 0) return;
  const cutoff = Date.now() - maxAgeMs;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const item = queue[i];
    if (item && item.createdAt < cutoff) {
      queue.splice(i, 1);
      notifyDropped(item, 'expired');
      safeDispatchDropHook(label, item.key, 'expired', item.dropPolicy ?? globalPolicy);
    }
  }
};

const enqueueWithPolicy = <T extends DroppableItem>(
  queue: T[],
  item: T,
  label: 'api' | 'sync',
): boolean => {
  evictExpired(queue, label);
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
    const dropped = queue.shift();
    queue.push(item);
    getLogger().debug(`offlineQueue:${label} full — dropped oldest item (policy=${effectivePolicy})`);
    if (dropped) {
      notifyDropped(dropped, 'queue-full');
      safeDispatchDropHook(label, dropped.key, 'queue-full', effectivePolicy);
    }
    return true;
  }
  if (effectivePolicy === 'drop-newest') {
    getLogger().debug(`offlineQueue:${label} full — dropped newest item (policy=${effectivePolicy})`);
    notifyDropped(item, 'queue-full');
    safeDispatchDropHook(label, item.key, 'queue-full', effectivePolicy);
    return false;
  }
  getLogger().warn(`offlineQueue:${label} full — rejecting enqueue (policy=${effectivePolicy})`);
  notifyDropped(item, 'queue-full');
  safeDispatchDropHook(label, item.key, 'queue-full', effectivePolicy);
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
  evictExpired(apiQueue, 'api');
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
  evictExpired(syncQueue, 'sync');
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
