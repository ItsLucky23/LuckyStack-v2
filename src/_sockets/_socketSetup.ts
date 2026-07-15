import type { Socket } from 'socket.io-client';
import { i18nNotify as notify, tryCatch, clearCsrfToken } from "@luckystack/core/client";
import {
  logging,
  ClientSessionPayload,
  socketActivityBroadcaster,
  loginPageUrl,
  sessionBasedToken,
  backendUrl,
} from "config";
import {
  socketEventNames,
} from "../../shared/socketEvents";
import { flushApiQueue, flushSyncQueue, isOnline } from "./offlineQueue";
import type { useSocketStatus } from "../_providers/socketStatusProvider";
import { initSyncRequest } from "./syncRequest";
import type { RefObject } from "react";

const shouldLogDev = logging.devLogs;
const shouldNotifyDev = logging.devNotifications;
const shouldLogSocketStatus = logging.socketStatus;

type SetSocketStatus = ReturnType<typeof useSocketStatus>["setSocketStatus"];

/** Wires the queue-flush logic: empties the offline queue on each (re)connect. */
export function attachQueueFlush(socketConnection: Socket) {
  const canFlushQueue = () => socketConnection.connected && isOnline();
  socketConnection.on(socketEventNames.connect, () => {
    flushApiQueue(canFlushQueue, socketConnection);
    flushSyncQueue(canFlushQueue, socketConnection);
  });
  return canFlushQueue;
}

/** Handles the document visibility event to signal intentional disconnect/reconnect. */
export function attachVisibilityHandler(
  socketConnection: Socket,
  getSocketStatus: () => ReturnType<typeof useSocketStatus>["socketStatus"],
) {
  const handler = () => {
    if (!socketActivityBroadcaster) return;

    if (shouldLogSocketStatus) {
      console.log(document.visibilityState);
    }

    //? user switched tab or navigated away
    if (document.visibilityState === "hidden") {
      socketConnection.emit(socketEventNames.intentionalDisconnect);
    } else {
      //? user switched back to the tab
      if (getSocketStatus().self.status !== "CONNECTED") {
        socketConnection.connect();
      }
      socketConnection.emit(socketEventNames.intentionalReconnect);
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => { document.removeEventListener("visibilitychange", handler); };
}

/** Throttled activity heartbeat so the server can track AFK state. */
export function attachActivityHeartbeat(socketConnection: Socket) {
  let lastActivitySent = 0;
  const activityEvents = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart"];

  const handleActivity = () => {
    if (!socketActivityBroadcaster) return;
    const now = Date.now();
    if (now - lastActivitySent < 10_000) return;
    lastActivitySent = now;
    socketConnection.emit(socketEventNames.activity);
  };

  if (socketActivityBroadcaster) {
    for (const eventName of activityEvents) {
      globalThis.addEventListener(eventName, handleActivity, { passive: true });
    }
  }

  return () => {
    for (const eventName of activityEvents) {
      globalThis.removeEventListener(eventName, handleActivity);
    }
  };
}

/** Attaches minimal connect/disconnect/error logs when presence is disabled. */
export function attachMinimalStatusLogs(socketConnection: Socket) {
  socketConnection.on(socketEventNames.connect, () => {
    if (shouldLogSocketStatus) {
      console.log("Connected to server");
    }
  });

  socketConnection.on(socketEventNames.disconnect, () => {
    if (shouldLogSocketStatus) {
      console.log("Disconnected, trying to reconnect...");
    }
  });

  socketConnection.on(socketEventNames.reconnectAttempt, (attempt) => {
    if (shouldLogSocketStatus) {
      console.log("Reconnecting attempt", attempt);
    }
  });

  socketConnection.on(socketEventNames.connectError, (err: { message: string }) => {
    if (shouldLogDev) {
      console.error(`Connection error: ${err.message}`);
    }
    if (shouldNotifyDev) {
      notify.error({ key: 'common.connectionError' });
    }
  });
}

/**
 * Wires session-lifecycle events: `sessionReplaced` toast, `logout` redirect,
 * and `updateSession` is handled separately in SessionProvider.
 */
export function attachSessionLifecycle(socketConnection: Socket) {
  //? Session replaced elsewhere (single-session enforcement or
  //? maxConcurrentPerUser cap kicking the oldest device). Server fires
  //? this just before its standard logout emit, giving us a chance to
  //? surface a translated toast so the user understands why they're
  //? being logged out.
  socketConnection.on(socketEventNames.sessionReplaced, () => {
    notify.warning({ key: 'common.sessionReplacedElsewhere' });
  });

  socketConnection.on(socketEventNames.logout, (status: "success" | "error") => {
    if (status === "success") {
      //? Loud log so we can see in devtools exactly when the server told us
      //? to log out — paired with the server-side `[session] logout success`
      //? warn this lets us correlate trigger ↔ effect across the wire.
      console.warn(
        `[session] Server emitted logout — clearing sessionStorage and redirecting to ${loginPageUrl}. ` +
        `If you did not click logout, check the server terminal for the corresponding "[session] logout success" stacktrace.`,
      );
      if (sessionBasedToken) {
        sessionStorage.clear();
      }
      //? Drop the CSRF cache so the next login fetches a fresh token bound
      //? to the new session.
      clearCsrfToken();
      if (!sessionBasedToken) {
        //? Cookie mode: the socket transport cannot clear the HttpOnly
        //? session cookie — ask the server to expire it over HTTP (POST
        //? /auth/logout answers with a Max-Age=0 Set-Cookie) before the
        //? redirect. Redirect regardless of the request outcome: the
        //? session is already invalidated server-side.
        void (async () => {
          await tryCatch(() => fetch(`${backendUrl}/auth/logout`, { method: "POST", credentials: "include" }));
          globalThis.location.href = loginPageUrl;
        })();
        return;
      }
      globalThis.location.href = loginPageUrl;
    } else {
      console.error("Logout failed");
      notify.error({ key: 'common.logoutFailed' });
    }
  });
}

/**
 * Dynamically imports `@luckystack/sync/client` and attaches the sync
 * receive listener. A missing package is a non-fatal no-op.
 */
export async function attachSyncReceiver(socketConnection: Socket) {
  //? Sync receive bridge. The incoming `sync` listener lives in
  //? `@luckystack/sync/client` (`attachSyncReceiver`) so the consumer doesn't
  //? carry a copy of the dispatch logic. Dynamic-imported + tryCatch so a base
  //? install WITHOUT `@luckystack/sync` simply runs without sync receive (no
  //? crash). Decoupled from the presence/activity flag — sync attaches whenever
  //? the package is present, independent of `socketActivityBroadcaster`.
  const [syncImportError, syncClient] = await tryCatch(() => import("@luckystack/sync/client"));
  if (syncImportError || !syncClient) {
    if (shouldLogDev) {
      console.log("[sync] @luckystack/sync/client not installed — sync receive disabled.");
    }
    return;
  }
  syncClient.attachSyncReceiver(socketConnection);
}

/** Reconnects + flushes queues when the browser comes back online. */
export function attachOnlineHandler(socketConnection: Socket, canFlushQueue: () => boolean) {
  const handler = () => {
    if (socketConnection.connected) {
      flushApiQueue(canFlushQueue, socketConnection);
      flushSyncQueue(canFlushQueue, socketConnection);
      return;
    }
    socketConnection.connect();
  };
  globalThis.addEventListener("online", handler);
  return () => { globalThis.removeEventListener("online", handler); };
}

/**
 * Wires all socket event handlers needed when `socketActivityBroadcaster` is
 * enabled (presence + sync route). Delegates to `initSyncRequest`.
 */
export function attachPresenceHandlers(
  setSocketStatus: SetSocketStatus,
  sessionRef: RefObject<ClientSessionPayload | null>,
) {
  void initSyncRequest({ setSocketStatus, sessionRef });
}
