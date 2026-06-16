export interface PrePresenceUpdatePayload {
  token: string;
  userId: string | null;
  kind: 'afk' | 'back';
  roomCodes: string[];
}

export interface PostPresenceUpdatePayload extends PrePresenceUpdatePayload {
  /** Number of peer sockets the event was emitted to. */
  recipientCount: number;
}

/**
 * Fired when a previously-disconnected socket reconnects WITHIN the
 * disconnect grace window (`projectConfig.presence` timer). The framework
 * uses this distinction internally; consumers subscribe to rehydrate
 * client state, replay missed events, or refresh caches. Cold-start
 * connects use `onSocketConnect` instead.
 */
export interface PostSocketReconnectPayload {
  token: string;
  userId: string | null;
  roomCodes: string[];
}

/**
 * Fired exactly once when a token's disconnect grace window expires WITHOUT a
 * reconnect — the moment a temporarily-disconnected user becomes permanently
 * gone. This is the only seam that fires at grace expiry:
 * - `onSocketDisconnect` (server) fires immediately at disconnect, before the
 *   grace verdict.
 * - login's session-delete hooks fire only when the session is actually
 *   deleted, and never on the tab-switch path (`sessionDeleted: false`).
 *
 * Use it to mark the user offline in the DB, persist final state, or audit the
 * departure. `userId` / `roomCodes` are resolved just before teardown so they
 * are still available even when the session is about to be deleted.
 */
export interface PostDisconnectGraceExpiredPayload {
  token: string;
  userId: string | null;
  roomCodes: string[];
  /** The socket.io disconnect reason that opened the grace window. */
  reason: string;
  /** Whether the session was deleted as part of this teardown (false on tab-switch). */
  sessionDeleted: boolean;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    prePresenceUpdate: PrePresenceUpdatePayload;
    postPresenceUpdate: PostPresenceUpdatePayload;
    postSocketReconnect: PostSocketReconnectPayload;
    postDisconnectGraceExpired: PostDisconnectGraceExpiredPayload;
  }
}
