//? Socket status shapes shared between `@luckystack/sync` and the project's
//? SocketStatusProvider. Moved here so framework packages don't need to
//? deep-relative-import into the project for a type.

export type SOCKETSTATUS =
  | "CONNECTED"
  | "DISCONNECTED"
  | "AFK"
  | "RECONNECTING"
  | "STARTUP";

export interface statusContent {
  status: SOCKETSTATUS;
  reconnectAttempt?: number;
  endTime?: number;
}
