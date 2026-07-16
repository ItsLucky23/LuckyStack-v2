import { describe, it, expect, afterEach } from 'vitest';
import { probeUpgradeSocketDelivery, assertRuntimeCanProxyWebsockets } from './runtimeCapabilities';

//? These guard the fix for the LAST thing this router needed before it could be
//? called multi-instance-ready: on Bun, `node:http` upgrade sockets are a silent
//? no-op (oven-sh/bun#28396, open), so the router served HTTP happily while
//? black-holing every WebSocket. The verdict path is dependency-injected because
//? Node CANNOT reproduce the Bun branch — the same reason `capabilities.test.ts`
//? pairs a functional test with an injected one.

const OVERRIDE = 'LUCKYSTACK_ALLOW_BROKEN_WS_PROXY';

afterEach(() => {
  delete process.env[OVERRIDE];
});

describe('probeUpgradeSocketDelivery', () => {
  it('returns true on a runtime whose upgrade sockets actually deliver (this one)', async () => {
    //? The suite runs on Node, where the upgrade path works. A `false` here means
    //? either the probe is broken or the runtime genuinely cannot proxy WS —
    //? both worth failing on.
    await expect(probeUpgradeSocketDelivery()).resolves.toBe(true);
  });

  it('settles and cleans up rather than hanging', async () => {
    //? REGRESSION: the first cut of the probe never settled on Node. An upgraded
    //? socket stays open, so `server.close()` waited on it forever and the boot
    //? guard would have hung the router at startup — on the runtime it is
    //? supposed to wave through. A self-inflicted outage worse than the bug it
    //? detects, and invisible on Bun (where the socket never opens).
    const started = Date.now();
    await probeUpgradeSocketDelivery();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  //? DELIBERATELY NOT TESTED HERE: "the probe returns false when no bytes
  //? arrive". The probe owns its server, so the only way to starve it on Node is
  //? a timeout short enough to beat loopback — which races loopback instead of
  //? testing anything. Written as `probeUpgradeSocketDelivery(1)` it failed 1 run
  //? in 6. A test that is red one time in six trains everyone to ignore red, and
  //? that costs more than the coverage is worth.
  //?
  //? The false path is covered where it is real instead: measured on Bun 1.3.14
  //? (returns false in ~3s, recorded in docs/findings/2026-07-15-bun-feasibility),
  //? and the verdict logic that CONSUMES a false is unit-tested below by
  //? injecting the probe.
});

describe('assertRuntimeCanProxyWebsockets', () => {
  it('does not probe at all on a non-Bun runtime', async () => {
    let probed = false;
    await assertRuntimeCanProxyWebsockets({
      isBunRuntime: false,
      probe: async () => { probed = true; return false; },
    });
    expect(probed, 'Node pays for a probe it never needed').toBe(false);
  });

  it('allows a Bun that CAN upgrade — the guard heals itself when upstream lands the fix', async () => {
    //? Deliberately not a runtime ban. `'Bun' in globalThis` answers "is this
    //? Bun"; the question is "does the upgrade path work". They diverge the day
    //? Bun merges oven-sh/bun#28396, and a hardcoded ban would then lock out a
    //? working runtime with nobody left who remembers why.
    await expect(assertRuntimeCanProxyWebsockets({
      isBunRuntime: true,
      probe: async () => true,
    })).resolves.toBeUndefined();
  });

  it('throws on a Bun that cannot upgrade, naming the upstream issue', async () => {
    const promise = assertRuntimeCanProxyWebsockets({
      isBunRuntime: true,
      probe: async () => false,
    });
    await expect(promise).rejects.toThrow(/cannot proxy WebSockets/);
    await expect(
      assertRuntimeCanProxyWebsockets({ isBunRuntime: true, probe: async () => false }),
    ).rejects.toThrow(/oven-sh\/bun#28396/);
  });

  it('downgrades to a warning when the operator opts out explicitly', async () => {
    process.env[OVERRIDE] = '1';
    await expect(assertRuntimeCanProxyWebsockets({
      isBunRuntime: true,
      probe: async () => false,
    })).resolves.toBeUndefined();
  });

  it('only honours the exact opt-out value', async () => {
    //? A stray/typo'd value must not silently disable a safety guard.
    process.env[OVERRIDE] = 'true';
    await expect(assertRuntimeCanProxyWebsockets({
      isBunRuntime: true,
      probe: async () => false,
    })).rejects.toThrow(/cannot proxy WebSockets/);
  });
});
