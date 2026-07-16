// Bun.serve() benchmark server — bun ONLY (native Zig HTTP server, bypassing the
// node:http compat layer). This is bun's HTTP ceiling — but note LuckyStack
// CANNOT use it: socket.io + the router are bound to node:http. It is measured
// here only to quantify how much the framework's architecture leaves on the table.
//
//   <bun> scripts/benchmark/httpServerBun.mjs <port>
//
// Same two endpoints + identical payload shaping as httpServerNode.mjs so the two
// servers are compared on equal output.
// See scripts/benchmark/README.md for how to drive it with `oha`.

if (!('Bun' in globalThis)) {
  process.stderr.write('httpServerBun.mjs requires bun (uses Bun.serve). Run with the bun binary.\n');
  process.exit(1);
}

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

const port = Number(process.argv[2] ?? 0);

// eslint-disable-next-line no-undef -- Bun is a bun-only global, guarded above
const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url);
    const body = url.pathname === '/work' ? buildWorkPayload() : '{"ok":true}';
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  },
});

process.stdout.write(`READY bun Bun.serve :${server.port}\n`);
