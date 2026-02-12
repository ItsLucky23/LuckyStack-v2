import { toast } from "sonner";
import { io, Socket } from 'socket.io-client';
import config, { dev, backendUrl, SessionLayout } from "config";
import { useSocketStatus } from "../_providers/socketStatusProvider";
import { RefObject, useEffect, useRef } from "react";
import { initSyncRequest, useSyncEventTrigger } from "./syncRequest";
import { flushApiQueue, flushSyncQueue, isOnline } from "./offlineQueue";

export let socket: Socket | null = null;

let responseIndex = 0;
export const incrementResponseIndex = () => {
  return responseIndex = responseIndex + 1;
}

export function useSocket(session: SessionLayout | null) {
  const { socketStatus, setSocketStatus } = useSocketStatus();
  const { triggerSyncEvent } = useSyncEventTrigger();
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session])

  useEffect(() => {
    const socketOptions: any = {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      autoConnect: true,
      withCredentials: true,
      auth: {}
    };

    if (import.meta.env.VITE_SESSION_BASED_TOKEN === "true") {
      const token = sessionStorage.getItem("token");
      if (token) {
        socketOptions.auth = { token };
      }
    }

    const socketConnection = io(backendUrl, socketOptions);
    socket = socketConnection;

    const canFlushQueue = () => socketConnection.connected && isOnline();

    const handleVisibility = async () => {
      if (!config.socketActivityBroadcaster) { return; }

      console.log(document.visibilityState)
      
      //? user switched tab or navigated away
      if (document.visibilityState === "hidden") {
        socketConnection.emit("intentionalDisconnect");

        //? user switched back to the tab
      } else if (document.visibilityState === "visible") {
        if (socketStatus.self.status !== "CONNECTED") {
          socketConnection.connect();
        }
        socketConnection.emit("intentionalReconnect");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    if (config.socketActivityBroadcaster) {
      initSyncRequest({
        socketStatus,
        setSocketStatus,
        sessionRef: sessionRef as RefObject<SessionLayout>
      })
    } else {
      socketConnection.on("connect", () => {
        console.log("Connected to server");
      });

      socketConnection.on("disconnect", () => {
        console.log("Disconnected, trying to reconnect...");
      });

      socketConnection.on("reconnect_attempt", (attempt) => {
        console.log(`Reconnecting attempt ${attempt}...`);
      });

      socketConnection.on("connect_error", (err) => {
        if (dev) {
          console.error(`Connection error: ${err.message}`);
          toast.error(`Connection error: ${err.message}`);
        }
      });
    }

    socketConnection.on("connect", () => {
      flushApiQueue(canFlushQueue);
      flushSyncQueue(canFlushQueue);
    });

    socketConnection.on("logout", (status: "success" | "error") => {
      if (status === "success") {
        if (import.meta.env.VITE_SESSION_BASED_TOKEN === "true") {
          sessionStorage.clear();
        }
        window.location.href = config.loginPageUrl;
      } else {
        console.error("Logout failed");
        toast.error("Logout failed");
      }
    });

    socketConnection.on("sync", ({ cb, clientOutput, serverOutput, message, status }) => {
      const path = window.location.pathname;
      if (dev) console.log("Server Sync Response:", { cb, clientOutput, serverOutput, status, message });

      if (status === "error") {
        if (dev) {
          console.log(message);
          toast.error(message);
        }
        return;
      }

      triggerSyncEvent(`sync${path}/${cb}`, clientOutput, serverOutput);
    });


    const handleOnline = () => {
      if (socketConnection.connected) {
        flushApiQueue(canFlushQueue);
        flushSyncQueue(canFlushQueue);
        return;
      }
      socketConnection.connect();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
        setSocketStatus(prev => ({
          ...prev,
          self: {
            status: "DISCONNECTED",
            reconnectAttempt: undefined,
            endTime: undefined,
          }
        }));
      }

      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("online", handleOnline)
    };

  }, []);

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
        toast.error("Socket is not initialized, giving up");
      }
      return false
    } //? we give it 500 * 10 so 5000ms or 5s to load the socket connection
  }

  return true
}

export const joinRoom = async (group: string) => {
  return new Promise(async (resolve) => {
    if (!group || typeof group !== "string") {
      if (dev) {
        console.error("Invalid group");
        toast.error("Invalid group");
      }
      return resolve(null);
    }

    if (!await waitForSocket()) { return resolve(null); }
    if (!socket) { return resolve(null); }

    const tempIndex = incrementResponseIndex();
    socket.emit('joinRoom', { group, responseIndex: tempIndex });

    socket.once(`joinRoom-${tempIndex}`, () => {
      return resolve(true);
    });
  })
}

export const updateLocationRequest = async ({ location }: { location: { pathName: string, searchParams: Record<string, string> } }) => {
  if (!location.pathName || !location.searchParams) {
    if (dev) {
      console.error("Invalid location");
      toast.error("Invalid location");
    }
    return null;
  }

  if (!await waitForSocket()) { return }
  if (!socket) { return null; }

  socket.emit('updateLocation', location);
}