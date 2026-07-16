import { io, ManagerOptions, SocketOptions } from 'socket.io-client';
import {
  backendUrl,
  logging,
  ClientSessionLayout,
  sessionBasedToken,
  socketActivityBroadcaster,
  locationProviderEnabled,
} from "config";
import { i18nNotify as notify, socket, setSocket, incrementResponseIndex, waitForSocket } from "@luckystack/core/client";
import { useSocketStatus } from "../_providers/socketStatusProvider";
import { useEffect, useRef } from "react";
import {
  buildGetJoinedRoomsResponseEventName,
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  socketEventNames,
} from "../../shared/socketEvents";
import {
  attachQueueFlush,
  attachVisibilityHandler,
  attachActivityHeartbeat,
  attachMinimalStatusLogs,
  attachSessionLifecycle,
  attachSyncReceiver,
  attachOnlineHandler,
  attachPresenceHandlers,
} from './_socketSetup';

//? The incoming `sync` socket listener + its route-key helpers now live in
//? `@luckystack/sync/client` (`attachSyncReceiver`), dynamic-imported below so a
//? base install without `@luckystack/sync` still builds + runs.

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
const shouldLogDev = logging.devLogs;
const shouldNotifyDev = logging.devNotifications;

// Socket state (`socket`, `incrementResponseIndex`, `waitForSocket`) now
// lives in @luckystack/core/socketState — single source of truth shared with
// `apiRequest` (core) and `syncRequest` (sync). This React hook is the only
// place that assigns the socket via `setSocket(io(...))`. Re-exported below
// so existing callers that still import these symbols from this file keep
// working.
// eslint-disable-next-line unicorn/prefer-export-from
export { socket, incrementResponseIndex, waitForSocket };

export function useSocket(session: ClientSessionLayout | null) {
  const { socketStatus, setSocketStatus } = useSocketStatus();
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
    setSocket(socketConnection);

    // Wire queue flush on reconnect
    const canFlushQueue = attachQueueFlush(socketConnection);

    // Wire visibility handler (tab switch → intentional disconnect/reconnect)
    const cleanupVisibility = attachVisibilityHandler(
      socketConnection,
      () => socketStatusRef.current,
    );

    // Wire activity heartbeat for AFK detection
    const cleanupActivity = attachActivityHeartbeat(socketConnection);

    // Wire presence or minimal status logs, depending on config
    if (socketActivityBroadcaster) {
      attachPresenceHandlers(setSocketStatus, sessionRef);
    } else {
      attachMinimalStatusLogs(socketConnection);
    }

    // Wire session lifecycle (sessionReplaced toast, logout redirect)
    attachSessionLifecycle(socketConnection);

    // Wire sync receive through the required sync client package.
    attachSyncReceiver(socketConnection);

    // Reconnect + flush on browser coming back online
    const cleanupOnline = attachOnlineHandler(socketConnection, canFlushQueue);

    return () => {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setDisconnectedStatus(setSocketStatus);
      }

      cleanupVisibility();
      cleanupOnline();
      cleanupActivity();
    };

  }, [setSocketStatus]);

  return socket;
}


// `waitForSocket` moved to @luckystack/core/socketState — re-exported at the
// top of this file to keep the existing symbol visible to callers.

export const joinRoom = async (group: string) => {
  return new Promise<{ success: true; rooms: string[] } | null>((resolve) => {
    void (async () => {
      if (!group || typeof group !== "string") {
        if (shouldLogDev) {
          console.error("Invalid group");
        }
        if (shouldNotifyDev) {
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
      socket.emit(socketEventNames.joinRoom, { group, responseIndex: tempIndex });

      socket.once(buildJoinRoomResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        //? The server emits `normalizeErrorResponse(...)` on failures, which has
        //? shape `{status:'error', errorCode, message, ...}` — NOT `{error}`.
        //? Treat any envelope with status:'error' or a non-empty errorCode as a
        //? failure so the spurious "you haven't joined" warning stops firing on
        //? auth/session errors that previously fell through the success branch.
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[joinRoom] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
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
        if (shouldLogDev) {
          console.error("Invalid group");
        }
        if (shouldNotifyDev) {
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
      socket.emit(socketEventNames.leaveRoom, { group, responseIndex: tempIndex });

      socket.once(buildLeaveRoomResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[leaveRoom] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
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
      socket.emit(socketEventNames.getJoinedRooms, { responseIndex: tempIndex });

      socket.once(buildGetJoinedRoomsResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[getJoinedRooms] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
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
    if (shouldLogDev) {
      console.error("Invalid location");
    }
    if (shouldNotifyDev) {
      notify.error({ key: 'common.invalidLocation' });
    }
    return null;
  }

  if (!await waitForSocket()) { return null; }
  if (!socket) { return null; }

  socket.emit(socketEventNames.updateLocation, location);
  return null;
}
