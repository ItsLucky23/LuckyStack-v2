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

declare module '@luckystack/core' {
  interface HookPayloads {
    prePresenceUpdate: PrePresenceUpdatePayload;
    postPresenceUpdate: PostPresenceUpdatePayload;
    postSocketReconnect: PostSocketReconnectPayload;
  }
}
