import { dev } from "config";

type ApiQueueItem = {
  id: string;
  key: string;
  run: () => void;
  createdAt: number;
};

type SyncQueueItem = {
  id: string;
  key: string;
  run: () => void;
  createdAt: number;
};

const apiQueue: ApiQueueItem[] = [];
const syncQueue: SyncQueueItem[] = [];
let isFlushing = false;

export const isOnline = () => {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
};

export const enqueueApiRequest = (item: ApiQueueItem) => {
  apiQueue.push(item);
  if (dev) {
    console.log("API request queued", { key: item.key, queueSize: apiQueue.length });
  }
};

export const enqueueSyncRequest = (item: SyncQueueItem) => {
  syncQueue.push(item);
  if (dev) {
    console.log("Sync request queued", { key: item.key, queueSize: syncQueue.length });
  }
};

export const removeApiQueueItem = (id: string) => {
  const index = apiQueue.findIndex((item) => item.id === id);
  if (index >= 0) {
    apiQueue.splice(index, 1);
  }
};

export const removeSyncQueueItem = (id: string) => {
  const index = syncQueue.findIndex((item) => item.id === id);
  if (index >= 0) {
    syncQueue.splice(index, 1);
  }
};

export const removeApiQueueItemsByKey = (key: string) => {
  for (let i = apiQueue.length - 1; i >= 0; i -= 1) {
    if (apiQueue[i].key === key) {
      apiQueue.splice(i, 1);
    }
  }
};

export const flushApiQueue = (canRun: () => boolean) => {
  if (isFlushing) return;
  if (apiQueue.length === 0) return;
  if (!canRun()) return;

  isFlushing = true;
  while (apiQueue.length > 0) {
    if (!canRun()) break;
    const item = apiQueue.shift();
    item?.run();
  }
  isFlushing = false;
};

export const flushSyncQueue = (canRun: () => boolean) => {
  if (isFlushing) return;
  if (syncQueue.length === 0) return;
  if (!canRun()) return;

  isFlushing = true;
  while (syncQueue.length > 0) {
    if (!canRun()) break;
    const item = syncQueue.shift();
    item?.run();
  }
  isFlushing = false;
};

export const getApiQueueSize = () => apiQueue.length;
export const getSyncQueueSize = () => syncQueue.length;
