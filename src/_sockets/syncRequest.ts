import { dev, SessionLayout } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import { statusContent } from "src/_providers/socketStatusProvider";
import { Dispatch, RefObject, SetStateAction } from "react";
import type {
  SyncPagePath,
  SyncName,
  SyncClientInput,
  SyncServerData,
  SyncClientOutput
} from "./apiTypes.generated";

// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers for Sync Requests
// ═══════════════════════════════════════════════════════════════════════════════

// Build a union of all sync calls: { name, clientInput, serverData, clientOutput }
type SyncCallUnion = {
  [P in SyncPagePath]: {
    [N in SyncName<P>]: {
      name: N;
      clientInput: SyncClientInput<P, N>;
      serverData: SyncServerData<P, N>;
      clientOutput: SyncClientOutput<P, N>;
    };
  }[SyncName<P>];
}[SyncPagePath];

// Get all sync names across all pages
export type AllSyncNames = SyncCallUnion['name'];

// Get clientInput for a given sync name (union if name exists on multiple pages)
type ClientInputForName<N extends AllSyncNames> = Extract<SyncCallUnion, { name: N }>['clientInput'];

// Get serverData for a given sync name (union if name exists on multiple pages)
type ServerDataForName<N extends AllSyncNames> = Extract<SyncCallUnion, { name: N }>['serverData'];

// Get clientOutput for a given sync name (union if name exists on multiple pages)
type ClientOutputForName<N extends AllSyncNames> = Extract<SyncCallUnion, { name: N }>['clientOutput'];

// Check if clientInput has required fields (not just Record<string, any>)
type IsClientInputRequired<T> = T extends Record<string, any>
  ? keyof T extends never ? false
  : string extends keyof T ? false
  : true
  : false;

// Build sync params with conditionally required data
type SyncParams<N extends AllSyncNames> = IsClientInputRequired<ClientInputForName<N>> extends true
  ? { name: N; data: ClientInputForName<N>; receiver: string; ignoreSelf?: boolean }
  : { name: N; data?: ClientInputForName<N>; receiver: string; ignoreSelf?: boolean };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

const syncEvents: Record<string, ((params: { clientOutput: any; serverData: any; aditionalData: any }) => void)> = {};

// ═══════════════════════════════════════════════════════════════════════════════
// syncRequest Function Overloads
// ═══════════════════════════════════════════════════════════════════════════════

// Overload 1: Page-specific - when user provides page path, get exact types
export function syncRequest<P extends SyncPagePath, N extends SyncName<P>>(
  params: { name: N; data?: SyncClientInput<P, N>; receiver: string; ignoreSelf?: boolean }
): Promise<boolean>;

// Overload 2: Global sync name - union types if name exists on multiple pages
export function syncRequest<N extends AllSyncNames>(
  params: SyncParams<N>
): Promise<boolean>;

// Implementation
export function syncRequest(
  params: { name: string; data?: any; receiver: string; ignoreSelf?: boolean }
): Promise<boolean> {
  let { name, data, receiver, ignoreSelf } = params;

  return new Promise(async (resolve) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name for syncRequest");
        toast.error("Invalid name for syncRequest");
      }
      return resolve(false);
    }

    if (!data || typeof data !== "object") {
      data = {};
    }

    if (!receiver) {
      if (dev) {
        console.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
        toast.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
      }
      return resolve(false);
    }

    if (!await waitForSocket()) { return resolve(false); }
    if (!socket) { return resolve(false); }

    const tempIndex = incrementResponseIndex();
    const pathname = window.location.pathname;
    const fullName = `sync${pathname}/${name}`;

    if (dev) { console.log(`Client Sync Request: `, { name, data, receiver, ignoreSelf }) }

    socket.emit('sync', { name: fullName, data, cb: name, receiver, responseIndex: tempIndex, ignoreSelf });

    socket.once(`sync-${tempIndex}`, (data: { status: "success" | "error", message: string }) => {
      if (data.status === "error") {
        if (dev) {
          console.error(`Sync ${name} failed: ${data.message}`);
          toast.error(`Sync ${name} failed: ${data.message}`);
        }
        return resolve(false);
      }
      resolve(data.status == "success");
    });
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// useSyncEvents Hook - Type-Safe Event Registration
// ═══════════════════════════════════════════════════════════════════════════════

// Type-safe callback for sync events
export type SyncEventCallback<N extends AllSyncNames> = (params: {
  clientOutput: ClientOutputForName<N>;
  serverData: ServerDataForName<N>;
}) => void;

export const useSyncEvents = () => {
  // Type-safe version: use with specific sync name
  function upsertSyncEventCallback<N extends AllSyncNames>(
    name: N,
    cb: SyncEventCallback<N>
  ): void;

  // Legacy version: accepts any string (for backward compatibility)
  function upsertSyncEventCallback(
    name: string,
    cb: (params: { clientOutput: any; serverData: any }) => void
  ): void;

  // Implementation
  function upsertSyncEventCallback(
    name: string,
    cb: (params: { clientOutput: any; serverData: any }) => void
  ): void {
    const path = window.location.pathname;
    syncEvents[`sync${path}/${name}`] = cb;
  }

  return { upsertSyncEventCallback };
}

export const useSyncEventTrigger = () => {

  const triggerSyncEvent = (name: string, clientOutput: any = {}, serverData: any = {}, aditionalData: any = {}) => {
    const cb = syncEvents[name];
    if (!cb) {
      if (dev) {
        console.log(syncEvents)
        console.error(`Sync event ${name} not found`);
        toast.error(`Sync event ${name} not found`);
      }
      return;
    }
    if (typeof cb == 'function') {
      cb({ clientOutput, serverData, aditionalData });
    }
  }

  return { triggerSyncEvent }
}

export const initSyncRequest = async ({
  socketStatus,
  setSocketStatus,
  sessionRef
}: {
  socketStatus: {
    self: statusContent;
    [userId: string]: statusContent;
  };
  setSocketStatus: Dispatch<
    SetStateAction<{
      self: statusContent;
      [userId: string]: statusContent;
    }>
  >;
  sessionRef: RefObject<SessionLayout> | null;
}) => {

  if (!await waitForSocket()) { return; }
  if (!socket) { return; }
  if (!sessionRef) { return; }

  socket.on("connect", () => {
    console.log(socketStatus)
    console.log("Connected to server");
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "CONNECTED",
        // reconnectAttempt: undefined,
      }
    }));
  });

  socket.on("disconnect", () => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
      }
    }));
    console.log("Disconnected, trying to reconnect...");
  });

  socket.on("reconnect_attempt", (attempt) => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "RECONNECTING",
        reconnectAttempt: attempt,
      }
    }));
    console.log(`Reconnecting attempt ${attempt}...`);
  });

  //? will not trigger when you call this event
  socket.on("userAfk", ({ userId, endTime }) => {
    if (userId == sessionRef.current?.id) {
      setSocketStatus(prev => ({
        ...prev,
        self: {
          status: "DISCONNECTED",
          reconnectAttempt: undefined,
          endTime
        }
      }));
    } else {
      setSocketStatus(prev => ({
        ...prev,
        [userId]: {
          status: "DISCONNECTED",
          endTime
        }
      }));
    }
  });

  //? will not trigger when you call this event
  socket.on("userBack", ({ userId }) => {
    console.log("userBack", { userId });

    setSocketStatus(prev => {
      const newStatus = { ...prev };
      newStatus[userId] = {
        status: "CONNECTED",
        endTime: undefined,
      };
      return newStatus;
    });
  });

  socket.on("connect_error", (err) => {
    console.log("connect_error", { err });
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
        reconnectAttempt: undefined,
      }
    }));
    if (dev) {
      console.error(`Connection error: ${err.message}`);
      toast.error(`Connection error: ${err.message}`);
    }
  });

}