//? SYNC-07 — default receiver authorization, shared by both sync transports.
//?
//? Historically a client could name ANY `receiver` (a room code, or the
//? cluster-wide `'all'` broadcast) and the framework fanned out regardless of
//? whether the requester had actually joined that room — `preSyncAuthorize` was
//? the only (opt-in, undocumented-as-required) gate. The core config keys
//? `sync.allowClientReceiverAll` / `sync.requireRoomMembership` add
//? framework-level defaults; this pure helper resolves the decision so the
//? socket + HTTP handlers stay single-source and the rule is unit-testable.
//?
//? Both flags default to today's permissive behavior (`allowClientReceiverAll:
//? true`, `requireRoomMembership: false`) so a missing key changes nothing.

/** Decision returned by {@link authorizeSyncReceiver}. */
export type ReceiverAuthDecision =
  | { allowed: true }
  | { allowed: false; errorCode: 'sync.receiverNotAllowed' | 'sync.notRoomMember' };

export interface AuthorizeSyncReceiverInput {
  /** The (already-trimmed, non-empty) receiver the client requested. */
  receiver: string;
  /** `sync.allowClientReceiverAll` from project config. */
  allowClientReceiverAll: boolean;
  /** `sync.requireRoomMembership` from project config. */
  requireRoomMembership: boolean;
  /**
   * Membership predicate for the requested room. Pass a function that reports
   * whether the requester has actually joined `receiver` — on the socket
   * transport this is `socket.rooms.has(receiver)`; on HTTP/SSE (no originator
   * socket) derive it from the session's persisted `roomCodes`. Pass `null`
   * ONLY when membership genuinely cannot be determined for this requester
   * (e.g. an anonymous HTTP caller with no session). When `null` and
   * `requireRoomMembership` is true, this helper FAILS CLOSED (rejects) rather
   * than silently delegating the security default to the opt-in
   * `preSyncAuthorize` hook.
   */
  isMember: (() => boolean) | null;
}

/**
 * Resolve whether a client may target `receiver` for a sync fanout under the
 * configured default policy. Returns `{ allowed: true }` when permitted, or a
 * specific generic error code when rejected. The `'all'` check runs first
 * (cluster-wide broadcasts are the riskiest), then room-membership.
 */
export const authorizeSyncReceiver = ({
  receiver,
  allowClientReceiverAll,
  requireRoomMembership,
  isMember,
}: AuthorizeSyncReceiverInput): ReceiverAuthDecision => {
  if (receiver === 'all' && !allowClientReceiverAll) {
    return { allowed: false, errorCode: 'sync.receiverNotAllowed' };
  }

  //? `'all'` is never a "joined room", so membership only gates concrete room
  //? codes. When `requireRoomMembership` is on we FAIL CLOSED: a known
  //? non-member is rejected, AND an UNDETERMINABLE membership (`isMember ===
  //? null`, e.g. an anonymous HTTP caller) is also rejected — previously the
  //? `null` case silently passed, so a consumer who set `requireRoomMembership:
  //? true` was protected on websockets but BYPASSED over the HTTP/SSE fallback
  //? (any `receiver`). The security default must not be silently delegated to
  //? the opt-in `preSyncAuthorize` hook.
  if (requireRoomMembership && receiver !== 'all' && !isMember?.()) {
    return { allowed: false, errorCode: 'sync.notRoomMember' };
  }

  return { allowed: true };
};
