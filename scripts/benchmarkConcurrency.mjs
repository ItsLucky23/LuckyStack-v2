// Concurrency / async-throughput benchmark. No deps. node and bun run identically.
// JS execution is single-threaded in BOTH (V8 / JSC) — this measures the ASYNC
// layer (event loop, I/O, HTTP), which is where a runtime difference actually lives.
import http from 'node:http';
const now = () => performance.now();
const runtime = 'Bun' in globalThis ? 'bun' : 'node';

// 1. Microtask / promise fan-out: many concurrent async chains resolving.
const promiseFanout = async () => {
  const t = now();
  const N = 200_000;
  const tasks = [];
  for (let i = 0; i < N; i++) tasks.push(Promise.resolve(i).then(x => x + 1).then(x => x * 2));
  const out = await Promise.all(tasks);
  return { ms: +(now() - t).toFixed(1), out: out.length };
};

// 2. setImmediate/timer scheduling throughput.
const timerThroughput = async () => {
  const t = now();
  const N = 50_000;
  let done = 0;
  await new Promise(resolve => {
    for (let i = 0; i < N; i++) setImmediate(() => { if (++done === N) resolve(); });
  });
  return { ms: +(now() - t).toFixed(1), out: done };
};

// 3. HTTP server throughput: server + concurrent client on the same runtime.
const httpThroughput = async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const TOTAL = 20_000, CONCURRENCY = 100;
  const url = `http://127.0.0.1:${port}/`;
  const t = now();
  let sent = 0, ok = 0;
  const worker = async () => {
    while (sent < TOTAL) {
      sent++;
      await new Promise((resolve, reject) => {
        const rq = http.get(url, res => { res.on('data', () => {}); res.on('end', () => { ok++; resolve(); }); });
        rq.on('error', reject);
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const ms = now() - t;
  await new Promise(r => server.close(r));
  return { ms: +ms.toFixed(1), out: ok, reqPerSec: Math.round(ok / (ms / 1000)) };
};

const fanout = await promiseFanout();
const timers = await timerThroughput();
const httpR = await httpThroughput();
process.stdout.write(JSON.stringify({ runtime, node: process.version, promiseFanout: fanout, timers, http: httpR }) + '\n');
