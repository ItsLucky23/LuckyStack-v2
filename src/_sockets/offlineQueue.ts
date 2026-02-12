import { dev } from "config";
import { Socket } from "socket.io-client";

type ApiQueueItem = {
  id: string;
  key: string;
  run: (socketInstance: Socket) => void;
  createdAt: number;
};

type SyncQueueItem = {
  id: string;
  key: string;
  run: (socketInstance: Socket) => void;
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
};

export const enqueueSyncRequest = (item: SyncQueueItem) => {
  syncQueue.push(item);
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

export const flushApiQueue = (canRun: () => boolean, socketInstance: Socket) => {
  if (isFlushing) return;
  if (apiQueue.length === 0) return;
  if (!canRun()) return;

  isFlushing = true;
  while (apiQueue.length > 0) {
    if (!canRun()) break;
    const item = apiQueue.shift();
    item?.run(socketInstance);
  }
  isFlushing = false;
};

export const flushSyncQueue = (canRun: () => boolean, socketInstance: Socket) => {
  if (isFlushing) return;
  if (syncQueue.length === 0) return;
  if (!canRun()) return;

  isFlushing = true;
  while (syncQueue.length > 0) {
    if (!canRun()) break;
    const item = syncQueue.shift();
    item?.run(socketInstance);
  }
  isFlushing = false;
};

export const getApiQueueSize = () => apiQueue.length;
export const getSyncQueueSize = () => syncQueue.length;
