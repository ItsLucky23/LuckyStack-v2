// Pure-compute runtime microbenchmark. NO dependencies, NO I/O — so `node` and
// `bun` execute byte-identical code and the only variable is the engine.
//
//   node scripts/benchmarkRuntime.mjs
//   <bun> scripts/benchmarkRuntime.mjs        (invoke bun by absolute path on
//                                              Windows; `bun run` through an npm
//                                              .cmd shim silently runs Node — see
//                                              docs/findings/2026-07-15-bun-feasibility)
//
// Each workload self-times with performance.now() and the script prints one JSON
// line: { runtime, node, results:[{name, ms, out}] }. Run it under each runtime
// and compare the medians of several runs. Lower ms = faster.
//
// The workloads are chosen to reflect real server work, not synthetic peaks:
//   fib    - tight numeric loop (JIT warm path)
//   sort   - comparator-heavy Array.sort over pseudo-random data
//   string - string concatenation + split (payload shaping)
//   json   - JSON.stringify + JSON.parse round-trip (the actual wire path)

const now = () => performance.now();

const fib = () => {
  let a = 0, b = 1;
  for (let i = 0; i < 40_000_000; i++) { const t = a + b; a = b; b = t % 1_000_000_007; }
  return b;
};

const sortWork = () => {
  let seed = 123_456_789;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff;
  let checksum = 0;
  for (let r = 0; r < 200; r++) {
    const arr = Array.from({ length: 50_000 }, () => rand());
    arr.sort((x, y) => x - y);
    checksum += arr[0] + arr[arr.length - 1];
  }
  return checksum;
};

const stringWork = () => {
  let acc = 0;
  for (let r = 0; r < 2_000; r++) {
    let s = '';
    for (let i = 0; i < 500; i++) s += `key${i}=value_${i * r},`;
    acc += s.length + s.split(',').length;
  }
  return acc;
};

const jsonWork = () => {
  const obj = { items: [], meta: {} };
  for (let i = 0; i < 300; i++) {
    obj.items.push({
      id: `id-${i}`,
      createdAt: new Date(1e12 + i).toISOString(),
      tags: ['a', 'b', 'c'],
      nested: { x: i, y: i * 2 },
    });
  }
  let total = 0;
  for (let r = 0; r < 3_000; r++) { total += JSON.parse(JSON.stringify(obj)).items.length; }
  return total;
};

const bench = (name, fn) => {
  const start = now();
  const out = fn();
  return { name, ms: +(now() - start).toFixed(1), out: String(out).slice(0, 8) };
};

const results = [
  bench('fib', fib),
  bench('sort', sortWork),
  bench('string', stringWork),
  bench('json', jsonWork),
];

const runtime = 'Bun' in globalThis ? 'bun' : 'node';
process.stdout.write(`${JSON.stringify({ runtime, node: process.version, results })}\n`);
