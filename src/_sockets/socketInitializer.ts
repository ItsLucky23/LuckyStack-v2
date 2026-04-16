import { io, ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import {
  dev,
  backendUrl,
  SessionLayout,
  sessionBasedToken,
  socketActivityBroadcaster,
  locationProviderEnabled,
  loginPageUrl,
} from "config";
import notify from "src/_functions/notify";
import { useSocketStatus } from "../_providers/socketStatusProvider";
import { useEffect, useRef } from "react";
import { initSyncRequest, useSyncEventTrigger } from "./syncRequest";
import type { SyncRouteStreamEvent } from "./syncRequest";
import { flushApiQueue, flushSyncQueue, isOnline } from "./offlineQueue";

interface SyncEventPayload {
  cb?: string;
  clientOutput?: unknown;
  serverOutput?: unknown;
  message?: string;
  status?: 'success' | 'error' | 'stream';
  fullName?: string;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
  [key: string]: unknown;
}

const normalizeSyncRouteKey = (value: string): string => {
  const sanitized = value.replaceAll(/^\/+|\/+$/g, '');
  if (sanitized.length === 0) return '';
  if (sanitized.startsWith('sync/')) return sanitized;
  return `sync/${sanitized}`;
};

const getSyncRouteKeys = ({
  fullName,
  cb,
}: {
  fullName?: string;
  cb?: string;
}) => {
  const keys = new Set<string>();

  if (typeof fullName === 'string') {
    const normalized = normalizeSyncRouteKey(fullName);
    if (normalized) {
      keys.add(normalized);
    }
  }

  if (typeof cb === 'string') {
    const normalized = normalizeSyncRouteKey(cb);
    if (normalized) {
      keys.add(normalized);
    }
  }

  return [...keys];
};

const setDisconnectedStatus = (setSocketStatus: ReturnType<typeof useSocketStatus>["setSocketStatus"]) => {
  setSocketStatus(prev => ({
    ...prev,
    self: {
      status: "DISCONNECTED",
      reconnectAttempt: undefined,
      endTime: undefined,
    }
  }));
};

const isLocationProviderEnabled: boolean = locationProviderEnabled;

export let socket: Socket | null = null;

let responseIndex = 0;
export const incrementResponseIndex = () => {
  return responseIndex = responseIndex + 1;
}

export function useSocket(session: SessionLayout | null) {
  const { socketStatus, setSocketStatus } = useSocketStatus();
  const { triggerSyncEvent, triggerSyncStreamEvent } = useSyncEventTrigger();
  const sessionRef = useRef(session);
  const socketStatusRef = useRef(socketStatus);

  useEffect(() => {
    sessionRef.current = session;
  }, [session])

  useEffect(() => {
    socketStatusRef.current = socketStatus;
  }, [socketStatus]);

  useEffect(() => {
    const socketOptions: Partial<ManagerOptions & SocketOptions> = {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      autoConnect: true,
      withCredentials: true,
      auth: {}
    };

    if (sessionBasedToken) {
      const token = sessionStorage.getItem("token");
      if (token) {
        socketOptions.auth = { token };
      }
    }

    const socketConnection = io(backendUrl, socketOptions);
    socket = socketConnection;

    const canFlushQueue = () => socketConnection.connected && isOnline();

    const handleVisibility = () => {
      if (!socketActivityBroadcaster) { return; }

      console.log(document.visibilityState)

      //? user switched tab or navigated away
      if (document.visibilityState === "hidden") {
        socketConnection.emit("intentionalDisconnect");

        //? user switched back to the tab
      } else {
        if (socketStatusRef.current.self.status !== "CONNECTED") {
          socketConnection.connect();
        }
        socketConnection.emit("intentionalReconnect");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    if (socketActivityBroadcaster) {
      void initSyncRequest({
        setSocketStatus,
        sessionRef,
      });
    } else {
      socketConnection.on("connect", () => {
        console.log("Connected to server");
      });

      socketConnection.on("disconnect", () => {
        console.log("Disconnected, trying to reconnect...");
      });

      socketConnection.on("reconnect_attempt", (attempt) => {
        console.log("Reconnecting attempt", attempt);
      });

      socketConnection.on("connect_error", (err: { message: string }) => {
        if (dev) {
          console.error(`Connection error: ${err.message}`);
          notify.error({ key: 'common.connectionError' });
        }
      });
    }

    socketConnection.on("connect", () => {
      flushApiQueue(canFlushQueue, socketConnection);
      flushSyncQueue(canFlushQueue, socketConnection);
    });

    socketConnection.on("logout", (status: "success" | "error") => {
      if (status === "success") {
        if (sessionBasedToken) {
          sessionStorage.clear();
        }
        globalThis.location.href = loginPageUrl;
      } else {
        console.error("Logout failed");
        notify.error({ key: 'common.logoutFailed' });
      }
    });

    socketConnection.on("sync", (payload: SyncEventPayload) => {
      const { cb, clientOutput, serverOutput, message, status, fullName, errorCode, errorParams } = payload;
      if (dev) console.log("Server Sync Response:", payload);

      const routeKeys = getSyncRouteKeys({ fullName, cb });

      if (status === "stream") {
        if (routeKeys.length === 0) {
          return;
        }

        const streamPayload = { ...payload };
        delete streamPayload.status;
        delete streamPayload.fullName;
        delete streamPayload.cb;

        for (const routeKey of routeKeys) {
          triggerSyncStreamEvent(routeKey, streamPayload as SyncRouteStreamEvent);
        }
        return;
      }

      if (status === "error") {
        if (errorCode === 'sync.ignore' || message === 'sync.ignore') {
          return;
        }
        if (dev) {
          if (errorCode) {
            notify.error({ key: errorCode, params: errorParams });
          } else if (message) {
            notify.error({ key: message });
          }
        }
        return;
      }

      if (routeKeys.length === 0) {
        const errorMessage = `Sync response is missing fullName for cb '${cb ?? 'unknown'}'.`;
        if (dev) {
          console.error(errorMessage);
          notify.error({ key: 'sync.invalidRequestFormat' });
        }
        throw new Error(errorMessage);
      }

      for (const routeKey of routeKeys) {
        triggerSyncEvent(routeKey, clientOutput, serverOutput);
      }
    });


    const handleOnline = () => {
      if (socketConnection.connected) {
        flushApiQueue(canFlushQueue, socketConnection);
        flushSyncQueue(canFlushQueue, socketConnection);
        return;
      }
      socketConnection.connect();
    };

    globalThis.addEventListener("online", handleOnline);

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
        setDisconnectedStatus(setSocketStatus);
      }

      document.removeEventListener("visibilitychange", handleVisibility)
      globalThis.removeEventListener("online", handleOnline)
    };

  }, [setSocketStatus, triggerSyncEvent, triggerSyncStreamEvent]);

  return socket;
}


export const waitForSocket = async () => {

  let i = 0;
  while (!socket) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    i++
    if (i > 500) {
      if (dev) {
        console.error("Socket is not initialized, giving up");
        notify.error({ key: 'common.socketNotInitialized' });
      }
      return false
    } //? we give it 500 * 10 so 5000ms or 5s to load the socket connection
  }

  return true
}

export const joinRoom = async (group: string) => {
  return new Promise<{ success: true; rooms: string[] } | null>((resolve) => {
    void (async () => {
      if (!group || typeof group !== "string") {
        if (dev) {
          console.error("Invalid group");
          notify.error({ key: 'common.invalidGroup' });
        }
        resolve(null);
        return;
      }

      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit('joinRoom', { group, responseIndex: tempIndex });

      socket.once(`joinRoom-${String(tempIndex)}`, (response?: { error?: string; rooms?: unknown }) => {
        if (response?.error) {
          if (dev) {
            console.error(response.error);
            notify.error({ key: response.error });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve({ success: true, rooms });
      });
    })();
  });
}

export const leaveRoom = async (group: string) => {
  return new Promise<{ success: true; rooms: string[] } | null>((resolve) => {
    void (async () => {
      if (!group || typeof group !== "string") {
        if (dev) {
          console.error("Invalid group");
          notify.error({ key: 'common.invalidGroup' });
        }
        resolve(null);
        return;
      }

      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit('leaveRoom', { group, responseIndex: tempIndex });

      socket.once(`leaveRoom-${String(tempIndex)}`, (response?: { error?: string; rooms?: unknown }) => {
        if (response?.error) {
          if (dev) {
            console.error(response.error);
            notify.error({ key: response.error });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve({ success: true, rooms });
      });
    })();
  });
}

export const getJoinedRooms = async () => {
  return new Promise<string[] | null>((resolve) => {
    void (async () => {
      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit('getJoinedRooms', { responseIndex: tempIndex });

      socket.once(`getJoinedRooms-${String(tempIndex)}`, (response?: { error?: string; rooms?: unknown }) => {
        if (response?.error) {
          if (dev) {
            console.error(response.error);
            notify.error({ key: response.error });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve(rooms);
      });
    })();
  });
}

export const updateLocationRequest = async ({ location }: { location: { pathName: string, searchParams: Record<string, string> } }) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this guard is required because deployments can toggle locationProviderEnabled
  if (!isLocationProviderEnabled) { return null; }

  if (!location.pathName) {
    if (dev) {
      console.error("Invalid location");
      notify.error({ key: 'common.invalidLocation' });
    }
    return null;
  }

  if (!await waitForSocket()) { return null; }
  if (!socket) { return null; }

  socket.emit('updateLocation', location);
  return null;
}