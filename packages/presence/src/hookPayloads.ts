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

declare module '@luckystack/core' {
  interface HookPayloads {
    prePresenceUpdate: PrePresenceUpdatePayload;
    postPresenceUpdate: PostPresenceUpdatePayload;
  }
}
