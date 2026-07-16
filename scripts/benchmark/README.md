# Benchmarks — the canonical harness

The runtime/PM benchmarks for this repo live here. **Use these, not a hand-rolled
load loop.** A naive node HTTP client caps at ~10k req/s and measures itself, not
the server — that mistake is documented in
`docs/findings/2026-07-16-npm-vs-bun-benchmark/` (the ~10k "ceiling" was the ruler,
not the wall). All HTTP numbers must come from a real load generator.

## The load tool: `oha`

[`oha`](https://github.com/hatoo/oha) — a native Rust HTTP load generator with
keep-alive, real concurrency, latency percentiles, and JSON output. It pushes far
past what a node client can, so it actually finds server ceilings.

Install (Windows, matches how `bun` was installed here):

```
winget install hatoo.oha
```

macOS: `brew install oha` · Linux: `cargo install oha` or a release binary.

After install, restart the shell so `oha` is on PATH, or pass `OHA_BIN=<path>`.

## Scripts

| Script | What it does | Runtime |
|---|---|---|
| `benchmarkRuntime.mjs` | Pure-compute (fib/sort/string/JSON round-trip), self-timed | `node` and `<bun>` — run under each, compare |
| `benchmarkConcurrency.mjs` | Async scheduling: promise fan-out, timers, in-process HTTP | `node` and `<bun>` |
| `httpServerNode.mjs` | `node:http` server (`/` trivial, `/work` shaped JSON) — the layer LuckyStack runs on | `node` and `<bun>` |
| `httpServerBun.mjs` | `Bun.serve()` native server, same endpoints — bun's ceiling (framework can't use it) | `<bun>` only |
| `runHttp.mjs` | Driver: starts each server config, drives it with `oha`, prints a req/s + latency table | `node` (spawns the rest) |

## Running the HTTP benchmark

```
# oha + bun on PATH:
node scripts/benchmark/runHttp.mjs

# or point at the binaries explicitly (Windows winget paths shown):
OHA_BIN="/c/…/hatoo.oha_*/oha.exe" \
BUN_BIN="/c/…/Oven-sh.Bun_*/bun-windows-x64/bun.exe" \
OHA_CONNECTIONS=200 OHA_DURATION=8s \
node scripts/benchmark/runHttp.mjs
```

Tunables (env): `OHA_CONNECTIONS` (default 200), `OHA_DURATION` (default `8s`),
`BENCH_PORT` (default 5091), `OHA_BIN`, `BUN_BIN`.

It benchmarks three server configs × two endpoints:

- **node + node:http** — the baseline the framework runs on today.
- **bun + node:http** — the framework running on bun (what a runtime switch buys).
- **bun + Bun.serve** — bun's native ceiling, measured only to show what the
  socket.io/router architecture leaves unreachable.

Each cell does one warm-up run then one measured run. Throughput varies run-to-run
under memory pressure — take a median of 3 for anything you quote, and note the
free-RAM figure (see the findings doc's methodology).

## Running the compute + concurrency benchmarks

```
node  scripts/benchmarkRuntime.mjs      # then:
<bun> scripts/benchmarkRuntime.mjs      # compare the two JSON lines
node  scripts/benchmarkConcurrency.mjs
<bun> scripts/benchmarkConcurrency.mjs
```

Both print one JSON line with self-timed workloads. The `out`/checksum fields
match across runtimes — a built-in correctness check that both ran identical work.
On Windows, invoke bun by absolute path: `bun run <script>` through an npm `.cmd`
shim silently executes Node (ledger 2026-07-15 B6).

## Recording results

Benchmark results are analysis, not defects — write them under a dated
`docs/findings/<date>-<slug>/README.md` with: the machine (cores + **free RAM**),
tool versions, the exact commands, medians (not single runs), and every caveat.
The existing `docs/findings/2026-07-16-npm-vs-bun-benchmark/` is the template.
