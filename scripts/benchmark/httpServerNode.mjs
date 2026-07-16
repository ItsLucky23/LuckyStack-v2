// node:http benchmark server — runs under BOTH node and bun (bun uses its
// node:http COMPAT layer here, which is the layer LuckyStack actually runs on:
// socket.io attaches to a node http.Server and the router is raw node:http).
//
//   node  scripts/benchmark/httpServerNode.mjs <port>
//   <bun> scripts/benchmark/httpServerNode.mjs <port>
//
// Two endpoints so the benchmark shows both the ceiling AND the realistic case:
//   GET /      -> trivial {"ok":true}          (max HTTP-layer difference)
//   GET /work  -> a shaped JSON payload         (what a real API response costs)
//
// See scripts/benchmark/README.md for how to drive it with `oha`.
import http from 'node:http';

const buildWorkPayload = () => {
  const items = [];
  for (let i = 0; i < 50; i++) {
    items.push({
      id: `id-${i}`,
      createdAt: new Date(1e12 + i * 1000).toISOString(),
      tags: ['a', 'b', 'c'],
      nested: { x: i, y: i * 2, label: `row-${i}` },
    });
  }
  return JSON.stringify({ status: 'success', result: { items } });
};

const server = http.createServer((req, res) => {
  if (req.url === '/work') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(buildWorkPayload());
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});

const port = Number(process.argv[2] ?? 0);
server.listen(port, '127.0.0.1', () => {
  const runtime = 'Bun' in globalThis ? 'bun' : 'node';
  process.stdout.write(`READY ${runtime} node:http :${server.address().port}\n`);
});
