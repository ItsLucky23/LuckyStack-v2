/**
 * Module augmentation: extends `@luckystack/core`'s `HookPayloads` interface
 * with socket lifecycle hooks owned by this package. Side-effect imported
 * by `index.ts` so consumers get the augmentation automatically.
 *
 * Hook semantics:
 *   - `on*` hooks are notifications. Handlers may side-effect; return values
 *     are ignored.
 *   - `pre*` hooks may return a `HookStopSignal` to abort the main flow. The
 *     stop signal carries an `errorCode` that's emitted back to the client.
 *   - `post*` hooks fire after the side-effect succeeds.
 */

export interface OnSocketConnectPayload {
  socketId: string;
  token: string | null;
  ip: string;
}

export interface OnSocketDisconnectPayload {
  socketId: string;
  token: string | null;
  reason: string;
}

export interface PreRoomJoinPayload {
  token: string;
  room: string;
}

export interface PostRoomJoinPayload {
  token: string;
  room: string;
  allRooms: string[];
}

export interface PreRoomLeavePayload {
  token: string;
  room: string;
}

export interface PostRoomLeavePayload {
  token: string;
  room: string;
  allRooms: string[];
}

export interface OnLocationUpdatePayload {
  token: string;
  oldLocation: { pathName: string; searchParams?: Record<string, string> } | undefined;
  newLocation: { pathName: string; searchParams?: Record<string, string> };
}

declare module '@luckystack/core' {
  interface HookPayloads {
    onSocketConnect: OnSocketConnectPayload;
    onSocketDisconnect: OnSocketDisconnectPayload;
    preRoomJoin: PreRoomJoinPayload;
    postRoomJoin: PostRoomJoinPayload;
    preRoomLeave: PreRoomLeavePayload;
    postRoomLeave: PostRoomLeavePayload;
    onLocationUpdate: OnLocationUpdatePayload;
  }
}
