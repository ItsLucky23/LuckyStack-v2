import { describe, it, expect } from "vitest";
import { authorizeSyncReceiver } from "./receiverAuth";

//? SYNC-07 — pure receiver-authorization policy resolver shared by both sync
//? transports. These cases lock in that the framework defaults stay permissive
//? (a missing/default config key changes nothing) while the opt-in flags reject
//? as specified — including FAILING CLOSED when `requireRoomMembership` is on
//? but membership is undeterminable (no silent HTTP bypass).

describe("authorizeSyncReceiver", () => {
  const permissive = {
    allowClientReceiverAll: true,
    requireRoomMembership: false,
  };

  it("allows any room code under the default permissive policy", () => {
    expect(
      authorizeSyncReceiver({ receiver: "room-A", ...permissive, isMember: null }),
    ).toEqual({ allowed: true });
  });

  it("allows 'all' under the default permissive policy", () => {
    expect(
      authorizeSyncReceiver({ receiver: "all", ...permissive, isMember: null }),
    ).toEqual({ allowed: true });
  });

  it("rejects 'all' when allowClientReceiverAll is false", () => {
    expect(
      authorizeSyncReceiver({
        receiver: "all",
        allowClientReceiverAll: false,
        requireRoomMembership: false,
        isMember: null,
      }),
    ).toEqual({ allowed: false, errorCode: "sync.receiverNotAllowed" });
  });

  it("still allows a concrete room when only allowClientReceiverAll is false", () => {
    expect(
      authorizeSyncReceiver({
        receiver: "room-A",
        allowClientReceiverAll: false,
        requireRoomMembership: false,
        isMember: () => true,
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects a non-member room when requireRoomMembership is true", () => {
    expect(
      authorizeSyncReceiver({
        receiver: "room-A",
        allowClientReceiverAll: true,
        requireRoomMembership: true,
        isMember: () => false,
      }),
    ).toEqual({ allowed: false, errorCode: "sync.notRoomMember" });
  });

  it("allows a joined room when requireRoomMembership is true", () => {
    expect(
      authorizeSyncReceiver({
        receiver: "room-A",
        allowClientReceiverAll: true,
        requireRoomMembership: true,
        isMember: () => true,
      }),
    ).toEqual({ allowed: true });
  });

  it("FAILS CLOSED when membership is undeterminable (isMember null) and required", () => {
    //? When `requireRoomMembership` is on and membership cannot be determined
    //? (e.g. an anonymous HTTP/SSE caller with no session), the helper must
    //? REJECT rather than silently delegating the security default to the
    //? opt-in preSyncAuthorize hook — that was the HTTP bypass (sync finding 1).
    expect(
      authorizeSyncReceiver({
        receiver: "room-A",
        allowClientReceiverAll: true,
        requireRoomMembership: true,
        isMember: null,
      }),
    ).toEqual({ allowed: false, errorCode: "sync.notRoomMember" });
  });

  it("allows an undeterminable membership when requireRoomMembership is OFF", () => {
    //? With the default permissive policy a null `isMember` is irrelevant.
    expect(
      authorizeSyncReceiver({
        receiver: "room-A",
        allowClientReceiverAll: true,
        requireRoomMembership: false,
        isMember: null,
      }),
    ).toEqual({ allowed: true });
  });

  it("does not membership-gate the 'all' broadcast (never a joined room)", () => {
    expect(
      authorizeSyncReceiver({
        receiver: "all",
        allowClientReceiverAll: true,
        requireRoomMembership: true,
        isMember: () => false,
      }),
    ).toEqual({ allowed: true });
  });
});
