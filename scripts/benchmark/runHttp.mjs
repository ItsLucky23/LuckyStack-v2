// HTTP throughput + latency benchmark driver. Starts each server configuration,
// drives it with `oha` (a native Rust HTTP load generator — see README.md), and
// prints a comparison table. This is the canonical way to benchmark the runtimes'
// HTTP behaviour; do not hand-roll a node client (it caps at ~10k req/s and
// measures the client, not the server — see docs/findings/2026-07-16-*).
//
//   node scripts/benchmark/runHttp.mjs
//
// Requires:
//   - oha on PATH, or OHA_BIN pointing at the binary. Install: winget install hatoo.oha
//   - bun on PATH, or BUN_BIN pointing at the binary (for the bun runtime configs)
//
// Tunables (env): OHA_CONNECTIONS (default 200), OHA_DURATION (default 8s),
//                 BENCH_PORT (default 5091).

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OHA = process.env.OHA_BIN ?? 'oha';
const BUN = process.env.BUN_BIN ?? 'bun';
const CONNECTIONS = process.env.OHA_CONNECTIONS ?? '200';
const DURATION = process.env.OHA_DURATION ?? '8s';
const PORT = Number(process.env.BENCH_PORT ?? 5091);

const nodeServer = path.join(HERE, 'httpServerNode.mjs');
const bunServer = path.join(HERE, 'httpServerBun.mjs');

//? A server config = a runtime + a server implementation. `Bun.serve` is bun-only
//? and is measured purely to show the ceiling the framework cannot reach (it is
//? bound to node:http via socket.io + the router).
const CONFIGS = [
  { label: 'node + node:http', bin: 'node', args: [nodeServer, String(PORT)] },
  { label: 'bun  + node:http', bin: BUN, args: [nodeServer, String(PORT)] },
  { label: 'bun  + Bun.serve', bin: BUN, args: [bunServer, String(PORT)] },
];

const ENDPOINTS = [
  { name: 'trivial /', path: '/' },
  { name: 'work /work', path: '/work' },
];

const preflight = () => {
  const oha = spawnSync(OHA, ['--version'], { encoding: 'utf8' });
  if (oha.status !== 0) {
    process.stderr.write(`oha not runnable (${OHA}). Install: winget install hatoo.oha, or set OHA_BIN.\n`);
    process.exit(1);
  }
  process.stdout.write(`oha: ${oha.stdout.trim()} | connections=${CONNECTIONS} duration=${DURATION}\n\n`);
};

const startServer = async (config) => {
  const proc = spawn(config.bin, config.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  proc.stdout.on('data', (d) => { if (String(d).includes('READY')) ready = true; });
  let err = '';
  proc.stderr.on('data', (d) => { err += String(d); });
  for (let i = 0; i < 50 && !ready; i++) await sleep(100);
  if (!ready) { proc.kill(); throw new Error(`server did not become ready: ${config.label}\n${err}`); }
  return proc;
};

const runOha = (url) => {
  const res = spawnSync(OHA, ['-z', DURATION, '-c', CONNECTIONS, '--no-tui', '--output-format', 'json', url], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`oha failed for ${url}: ${res.stderr}`);
  const j = JSON.parse(res.stdout);
  return {
    rps: Math.round(j.summary.requestsPerSec),
    p50ms: +(j.latencyPercentiles.p50 * 1000).toFixed(2),
    p99ms: +(j.latencyPercentiles.p99 * 1000).toFixed(2),
    ok: j.summary.successRate,
  };
};

const main = async () => {
  preflight();
  const rows = [];
  for (const config of CONFIGS) {
    const proc = await startServer(config);
    try {
      for (const ep of ENDPOINTS) {
        //? One warm-up + one measured run; the warm-up lets JIT/allocators settle.
        runOha(`http://127.0.0.1:${PORT}${ep.path}`);
        const r = runOha(`http://127.0.0.1:${PORT}${ep.path}`);
        rows.push({ config: config.label, endpoint: ep.name, ...r });
        process.stdout.write(`  ${config.label.padEnd(18)} ${ep.name.padEnd(12)} ${String(r.rps).padStart(8)} req/s  p50=${r.p50ms}ms p99=${r.p99ms}ms ok=${(r.ok * 100).toFixed(1)}%\n`);
      }
    } finally {
      proc.kill();
      await sleep(300);
    }
  }

  process.stdout.write('\n=== summary (req/s, higher = better) ===\n');
  for (const ep of ENDPOINTS) {
    process.stdout.write(`\n${ep.name}:\n`);
    const forEp = rows.filter((r) => r.endpoint === ep.name);
    for (const r of forEp) process.stdout.write(`  ${r.config.padEnd(18)} ${String(r.rps).padStart(8)} req/s\n`);
  }
  process.stdout.write('\n(JSON)\n' + JSON.stringify(rows) + '\n');
};

main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + '\n'); process.exit(1); });
