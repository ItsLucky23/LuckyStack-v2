import { describe, it, expect, vi, beforeEach } from "vitest";

//? N-4 (SYNC-17): the per-recipient `_client` dispatch hands a tryCatch context
//? to `captureException`. The raw bearer session token must NOT appear there —
//? it is a usable credential. `@luckystack/core` is mocked so we can capture the
//? exact context object passed to `tryCatch` and assert the token is redacted.

//? Hoisted so the spy exists before the (hoisted) `vi.mock` factory runs. Typed
//? with the real 3-arg `tryCatch` signature so `.mock.calls[i][2]` (the captured
//? error context) is reachable under the build's `tsc -b` typecheck.
const { tryCatch } = vi.hoisted(() => ({
  tryCatch: vi.fn(
    async (
      fn: () => Promise<unknown>,
      _fallback?: unknown,
      _context?: Record<string, unknown>,
    ): Promise<[unknown, unknown]> => {
      const result = await fn();
      return [null, result];
    },
  ),
}));

vi.mock("@luckystack/core", () => ({
  tryCatch,
  socketEventNames: { sync: "sync" },
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { processClientSyncForRecipient } from "./clientFanout";

const RAW_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789";

const makeArgs = (tempToken: string | null) => ({
  tempSocket: { emit: vi.fn(), handshake: { headers: {} } },
  tempToken,
  clientSyncHandler: vi.fn(async () => ({ status: "success" as const })),
  data: {},
  functionsObject: {},
  serverOutput: { status: "success" as const },
  receiver: "room-A",
  resolvedName: "sync/chat/sendMessage/v1",
  callbackKey: "cb-1",
  transport: "socket" as const,
  handlerName: "handleSyncRequest" as const,
  logLabel: "sync" as const,
  shouldLogDev: () => false,
  shouldLogStream: () => false,
  buildSyncError: vi.fn(() => ({})),
  resolvePreferredLocale: () => null,
});

describe("processClientSyncForRecipient — token redaction in error context", () => {
  beforeEach(() => {
    tryCatch.mockClear();
  });

  it("redacts the raw session token before it reaches the tryCatch error context", async () => {
    await processClientSyncForRecipient(makeArgs(RAW_TOKEN));

    expect(tryCatch).toHaveBeenCalledTimes(1);
    const context = tryCatch.mock.calls[0]?.[2] ?? {};
    //? Truncated to the 8-char prefix — the raw credential is not recoverable.
    expect(context.targetToken).toBe("abcdefgh…");
    expect(JSON.stringify(context)).not.toContain("ijklmnop");
  });

  it("leaves a null token unchanged (nothing to redact)", async () => {
    await processClientSyncForRecipient(makeArgs(null));

    const context = tryCatch.mock.calls[0]?.[2] ?? {};
    expect(context.targetToken).toBeNull();
  });
});
