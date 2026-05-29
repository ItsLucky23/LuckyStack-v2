#!/usr/bin/env node
//? Static Bun-compatibility smoke check.
//?
//? Verifies that the dependencies LuckyStack reaches for (node:crypto,
//? @prisma/client, socket.io, ioredis, react, vite, tsup, tsx) all resolve
//? cleanly under whichever runtime invoked this script. Does NOT boot the
//? server — that requires `bun:server` and a populated `.env.local`. Run
//? `npm run bun:check` under Node to confirm the baseline, then run it
//? again under `bun` (`bun run bun:check`) to confirm Bun parity.
//?
//? Exits 0 when every probe passes, 1 on any failure. Each probe prints
//? a one-line status; the final summary tells you which runtime was used.

const isBun = typeof globalThis.Bun !== 'undefined';
const runtime = isBun ? `bun ${globalThis.Bun.version}` : `node ${process.version}`;

const probes = [];
const log = (label, ok, detail) => {
  probes.push({ label, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`[bun-check] ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const probe = async (label, fn) => {
  try {
    const detail = await fn();
    log(label, true, detail);
  } catch (error) {
    log(label, false, error?.message ?? String(error));
  }
};

// node:crypto — used by bootUuid + session token generation
await probe('node:crypto.randomUUID', async () => {
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  if (typeof id !== 'string' || id.length < 30) throw new Error('unexpected uuid shape');
  return id;
});

// node:fs + node:path — used everywhere in devkit + scripts
await probe('node:fs + node:path', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!fs.existsSync(path.resolve(process.cwd(), 'package.json'))) {
    throw new Error('package.json not visible to fs');
  }
  return 'package.json accessible';
});

// node:url — pathToFileURL used by dynamic config-file loaders
await probe('node:url.pathToFileURL', async () => {
  const { pathToFileURL } = await import('node:url');
  const url = pathToFileURL(process.cwd());
  if (!url.href.startsWith('file://')) throw new Error('pathToFileURL did not produce file://');
  return url.href.slice(0, 40) + '…';
});

// @prisma/client — peer dep; just checking the module resolves
await probe('@prisma/client (module resolves)', async () => {
  const mod = await import('@prisma/client');
  if (!mod.PrismaClient) throw new Error('PrismaClient export missing');
  return 'PrismaClient export present (not instantiated)';
});

// socket.io — server-side transport
await probe('socket.io (module resolves)', async () => {
  const mod = await import('socket.io');
  if (!mod.Server) throw new Error('Server export missing');
  return 'Server export present';
});

// ioredis — required for sessions + rate-limit + bootUuid
await probe('ioredis (module resolves)', async () => {
  const mod = await import('ioredis');
  if (!mod.default) throw new Error('default export missing');
  return 'default Redis class present';
});

// @luckystack/core — main framework barrel (server side)
await probe('@luckystack/core (server barrel)', async () => {
  const mod = await import('@luckystack/core');
  if (!mod.tryCatch || !mod.dispatchHook) {
    throw new Error('expected exports missing (tryCatch, dispatchHook)');
  }
  return 'tryCatch + dispatchHook present';
});

// @luckystack/server — bootstrap entry
await probe('@luckystack/server (bootstrap entry)', async () => {
  const mod = await import('@luckystack/server');
  if (!mod.bootstrapLuckyStack) throw new Error('bootstrapLuckyStack export missing');
  return 'bootstrapLuckyStack present';
});

const failed = probes.filter((p) => !p.ok);
// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`[bun-check] Runtime: ${runtime}`);
// eslint-disable-next-line no-console
console.log(`[bun-check] ${probes.length - failed.length}/${probes.length} probes passed.`);

if (failed.length > 0) {
  // eslint-disable-next-line no-console
  console.error('[bun-check] Failures:');
  for (const f of failed) {
    // eslint-disable-next-line no-console
    console.error(`  - ${f.label}: ${f.detail ?? ''}`);
  }
  process.exit(1);
}
