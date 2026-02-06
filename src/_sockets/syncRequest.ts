import { dev, SessionLayout } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import { statusContent } from "src/_providers/socketStatusProvider";
import { Dispatch, RefObject, SetStateAction } from "react";
import type {
  SyncPagePath,
  SyncName,
  SyncClientInput,
  SyncServerOutput,
  SyncClientOutput
} from "./apiTypes.generated";

// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers for Sync Requests
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = {} extends T ? false : true;

// Force expansion of types to clear aliases in tooltips
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ═══════════════════════════════════════════════════════════════════════════════
// Global Sync Params
// ═══════════════════════════════════════════════════════════════════════════════

// All possible sync names across all pages
export type AllSyncNames = {
  [P in SyncPagePath]: SyncName<P>
}[SyncPagePath];

// Get clientInput type for a sync name (union if exists on multiple pages)
type ClientInputForName<N extends AllSyncNames> = {
  [P in SyncPagePath]: N extends SyncName<P> ? SyncClientInput<P, N> : never
}[SyncPagePath];

// Get serverOutput type for a sync name (union if exists on multiple pages)
type ServerOutputForName<N extends AllSyncNames> = {
  [P in SyncPagePath]: N extends SyncName<P> ? SyncServerOutput<P, N> : never
}[SyncPagePath];

// Get clientOutput type for a sync name (union if exists on multiple pages)
type ClientOutputForName<N extends AllSyncNames> = {
  [P in SyncPagePath]: N extends SyncName<P> ? SyncClientOutput<P, N> : never
}[SyncPagePath];

// Build params type for a specific sync name
type SyncParamsForName<N extends AllSyncNames> =
  DataRequired<ClientInputForName<N>> extends true
  ? { name: N; data: Prettify<ClientInputForName<N>>; receiver: string; ignoreSelf?: boolean }
  : { name: N; data?: Prettify<ClientInputForName<N>>; receiver: string; ignoreSelf?: boolean };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

const syncEvents: Record<string, ((params: { clientOutput: any; serverOutput: any; aditionalData: any }) => void)> = {};

// ═══════════════════════════════════════════════════════════════════════════════
// Page-Specific Params (for exact types when duplicate names exist)
// ═══════════════════════════════════════════════════════════════════════════════

// Build params type for a specific page and sync name
type PageSyncParamsForName<P extends SyncPagePath, N extends SyncName<P>> =
  DataRequired<SyncClientInput<P, N>> extends true
  ? { name: N; data: SyncClientInput<P, N>; receiver: string; ignoreSelf?: boolean }
  : { name: N; data?: SyncClientInput<P, N>; receiver: string; ignoreSelf?: boolean };

// ═══════════════════════════════════════════════════════════════════════════════
// syncRequest Function Overloads
// ═══════════════════════════════════════════════════════════════════════════════

// Overload 1: Name-based inference - PRIMARY usage
// TypeScript infers N from the literal name value
export function syncRequest<N extends AllSyncNames>(
  params: SyncParamsForName<N>
): Promise<boolean>;

// Overload 2: Explicit page + name - for duplicate sync names across pages
// Both type params REQUIRED when specifying page
export function syncRequest<P extends SyncPagePath, N extends SyncName<P>>(
  params: PageSyncParamsForName<P, N>
): Promise<boolean>;

// Implementation
export function syncRequest(params: any): Promise<boolean> {
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
  serverOutput: ServerOutputForName<N>;
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
    cb: (params: { clientOutput: any; serverOutput: any }) => void
  ): void;

  // Implementation
  function upsertSyncEventCallback(
    name: string,
    cb: (params: { clientOutput: any; serverOutput: any }) => void
  ): void {
    const path = window.location.pathname;
    syncEvents[`sync${path}/${name}`] = cb;
  }

  return { upsertSyncEventCallback };
}

export const useSyncEventTrigger = () => {

  const triggerSyncEvent = (name: string, clientOutput: any = {}, serverOutput: any = {}, aditionalData: any = {}) => {
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
      cb({ clientOutput, serverOutput, aditionalData });
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