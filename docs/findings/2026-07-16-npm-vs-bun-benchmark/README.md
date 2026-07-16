# Benchmark — npm+node vs bun (runtime + package manager) — 2026-07-16

> Analysis, not a defect ledger — no `open`/`fixed` items to track. Recorded here
> because the Findings Protocol is where dated, reproducible measurements live.

Last updated: 2026-07-16 (revised — added the idempotent-install + concurrency axes after review)

## TL;DR

| Axis | Winner | Margin | Notes |
|---|---|---|---|
| **Runtime — compute (JSON, sort)** | **bun** | 1.5–1.6× | The server hot path; bun clearly ahead |
| **Runtime — compute (fib, string)** | ~tie | ~1.0× | Within noise |
| **Runtime — TypeScript execution** | **bun** | ~2.9× vs tsx (up to ~12× vs `npx tsx`) | Native TS vs tsx transpile; the real `server` boot path |
| **Runtime — process startup (plain JS)** | ~tie | node ~10 ms less | Noise on Windows |
| **Runtime — async scheduling (promises, timers)** | **bun** | 1.6–1.9× | Real event-loop advantage |
| **Runtime — HTTP throughput, realistic `/work` (via `oha`)** | **bun** | **1.83×** on `node:http` | The framework's real path; measured with a proper load tool — corrects an earlier client-bottlenecked "~tie" |
| **Runtime — HTTP, `Bun.serve()` beyond `node:http`** | bun | +~14% on `/work` | Bun's native ceiling — but architecturally unreachable (socket.io/router need node:http) |
| **Install — clean (empty node_modules)** | **npm** | ~3× | Windows hardlink-materialization; see caveats |
| **Install — idempotent re-install (node_modules present)** | **bun** | **~10×** | 259 ms vs 2.5 s — the everyday `install`-after-pull case |

Headline (revised twice): **bun is the faster runtime nearly everywhere that matters for running the app** — execution, async scheduling, TS startup, HTTP throughput, and the everyday re-install. **npm wins one specific case: a clean install into an empty `node_modules` on Windows** (~3×). Corrections review forced: (1) bun *dominates* the idempotent re-install developers run most (~10×); (2) **an earlier "HTTP ~tie" was a client-bottleneck artifact — with `oha`, bun's `node:http` is `1.83×` node's on a realistic response, a big win the framework captures for free**; (3) the architecture caps only the *extra* `Bun.serve()` gain (~14% on real work), not the main runtime win.

## Machine

- Windows 11, 16 cores, 15.8 GB RAM — **but only ~0.6 GB free at test time** (the developer's own dev stack was running: ~48 node processes). CPU idle (~12%).
- node v22.14.0 · npm 11.6.1 · bun 1.3.14.
- **The low free-memory figure matters for the install numbers** (I/O + many processes), less so for the compute microbenchmarks (CPU-bound, low memory). Every number below is a caveat away from a quiet machine; the compute ones would barely move, the install ones could.

## Runtime — compute (`scripts/benchmarkRuntime.mjs`)

Pure-compute, no deps, no I/O, so node and bun run byte-identical code. 5 runs each, per-workload **median** (ms, lower = faster). The workload checksums are identical across runtimes (built-in correctness check — both really did the same work).

| workload | node (med) | bun (med) | speedup |
|---|---|---|---|
| fib (numeric loop) | 127.3 | 116.7 | 1.09× bun |
| sort (comparator-heavy) | 3977 | 2656 | **1.50× bun** |
| string (concat + split) | 121.6 | 120.8 | 1.01× (tie) |
| json (stringify + parse round-trip) | 988.7 | 616.5 | **1.60× bun** |

The two that matter for a socket-first server — **JSON round-trips** (every API/sync response) and **sort** — are exactly where bun pulls ahead. `fib`/`string` are near-parity.

Reproduce: `node scripts/benchmarkRuntime.mjs` and `<bun> scripts/benchmarkRuntime.mjs` (invoke bun by absolute path — `bun run` through an npm `.cmd` shim silently runs Node, ledger B6).

## Runtime — TypeScript execution + startup

Wall-clock, median of 9, lower = faster.

| scenario | median (ms) | |
|---|---|---|
| node — plain JS startup (`tiny.mjs`) | 103 | baseline |
| bun — plain JS startup | 113 | ~tie (node ~10 ms less; noise) |
| **node + tsx** (direct cli) | **474** | TS transpile + run via tsx |
| node + tsx (via `npx tsx`) | 1964 | + npx resolution penalty each cold call |
| **bun — native TS** | **163** | **~2.9× faster than tsx, ~12× faster than the npx path** |

This is the real `npm run server` (`npx tsx …`) vs `bun run server` story. bun compiles TS natively; the framework's `npx tsx` scripts pay both the tsx transpile cost *and* a large npx-resolution cost on every cold invocation, all of which bun sidesteps. Plain-JS process startup is a tie — bun's win here is entirely the TS toolchain it replaces.

## Package install — two scenarios, and they point opposite ways

Realistic tree: the scaffold template's public deps (`react`, `vite`, the full eslint stack, `prisma`, `tailwind`, `socket.io`, …) minus the `@luckystack/*` workspace deps — **45 direct, ~23.4k files installed**. Both PMs: warm cache, isolated cache dir on the same C: volume, `--ignore-scripts` (pure resolve+link — excludes sharp's native compile and prisma generate, which would add non-PM variance). 3 runs, median (ms).

**A review question drove this rewrite: "did npm win only because the packages were already installed?"** No — and it is worth proving rather than asserting. In the clean-install runs below, `node_modules` was verified **empty (0 files) before every timed run** for BOTH tools, and full (23.4k) after. Both installed from scratch each time. But the question pointed at a real second scenario the first draft missed — the everyday re-install — and there the result flips hard.

### Scenario A — clean install (empty `node_modules`, from committed lockfile)

The CI/first-checkout case: `npm ci` vs `bun install --frozen-lockfile`, `rm -rf node_modules` before each run.

| installer | runs (files before → after) | median |
|---|---|---|
| **npm ci** | 14304 / 13972 / 13812 (0 → 23471) | **13972 ms** |
| bun install --frozen-lockfile | 43457 / 42744 / 43084 (0 → 23333) | **43084 ms** |

**npm ~3× faster here.** Mechanism verified, not assumed: **both hardlink from cache** (bun's `react/package.json` had a hardlink count of 2, `--backend=hardlink` is its default) — so it is *not* copy-vs-hardlink. bun is simply slower at materializing ~23k hardlinks on Windows (per-file overhead; Windows Defender scanning each write hits both, plausibly bun's path harder).

### Scenario B — idempotent re-install (`node_modules` already present, nothing to do)

The command a developer actually runs most: `install` after a `git pull` with no dependency changes. Both tools should detect "up to date" and no-op.

| installer | runs (node_modules present) | median |
|---|---|---|
| npm install | 2510 / 3089 / 2059 | 2510 ms |
| **bun install --frozen-lockfile** | 5540 / 259 / 257 | **259 ms** |

**bun ~10× faster here.** bun recognises the tree is satisfied and returns in ~260 ms; npm re-verifies the whole tree every time (~2.5 s). (bun's first run was 5.5 s — it does one fuller verification pass, then the steady state is ~260 ms.) So the tool that loses the clean install by 3× wins the *repeat* install by 10×, and the repeat is the common case.

### Caveats — do not over-generalize either number
- **Windows-specific.** bun's headline clean-install speed is a Linux/macOS result; its Windows filesystem path has historically lagged. Says nothing about bun-install on a Linux CI runner — re-measure there.
- **Memory-pressured** (~0.6–0.7 GB free throughout). Not re-run on a quiet machine.
- **Warm-cache.** The cold-cache (first-ever download) axis is bun's *parallel-download* strength and was deliberately excluded to isolate the linker; the one cold sample was network-noisy and inconclusive (npm 41 s vs bun 83 s, single run).

## Concurrency / async throughput (`scripts/benchmarkConcurrency.mjs`)

A second review question: **"can bun's runtime handle more parallelism/concurrency?"** First, the honest framing: **JS execution is single-threaded in BOTH** — node on V8, bun on JavaScriptCore. Neither runs your JS across cores without `worker_threads`. So "more parallel" is not the right axis; the real question is *async/event-loop throughput*, and there bun does win. 3 runs each, medians:

| workload | node | bun | |
|---|---|---|---|
| Promise fan-out (200k concurrent chains) | ~118 ms | ~72 ms | **1.6× bun** |
| Timer / `setImmediate` throughput (50k) | ~19 ms | ~10 ms | **1.9× bun** |
| HTTP throughput — server + client on the **same** runtime | ~6600 req/s | ~9260 req/s | 1.4× bun* |
| **HTTP *server* throughput, isolated** (fixed node load-gen → each server) | **~9000 req/s** | **~9270 req/s** | **~tie** |

\* The 1.4× same-runtime HTTP result is **misleading and the isolated row corrects it.** When one fixed node client drives both servers, they serve at the same rate (~2–4% apart, within noise) — so bun's HTTP *server* is not meaningfully faster; the same-runtime advantage was bun's faster *client* (`http.get`) side. The isolated test tops out at the load-generator's own ceiling (~9k req/s), so it proves the servers are *equivalent up to that point*, not either server's true maximum.

**Takeaway:** bun's genuine concurrency wins are in async *scheduling* — microtask (promise) and timer throughput, ~1.6–1.9× — which help a busy event loop. Its HTTP *server* throughput is also ahead once measured with a real load tool (see below — the "~tie" in the table above was a client-bottleneck artifact, `1.83×` on realistic responses via `oha`). To scale beyond one core, both need multiple instances behind the router (`docs/ARCHITECTURE_MULTI_INSTANCE.md`), regardless of runtime — but each instance serves more on bun.

### Why online benchmarks show "Bun HTTP: very high" and I don't — and why it doesn't help LuckyStack

Reviewer challenge: online feature tables rate Bun's HTTP throughput far above node's. They are right — about **`Bun.serve()`**, bun's native Zig HTTP server, which bypasses the `node:http` compat layer. I measured `node:http`, because **that is what LuckyStack uses**: socket.io attaches to a `http.Server`, and the router is raw `node:http` (+ `node:net` for the WS upgrade). Under bun, `node:http` is bun's *compatibility* implementation, roughly on par with node — which is exactly the ~tie I measured.

I tried to demonstrate the `Bun.serve()` advantage directly and **could not, honestly** — my hand-rolled node load generator caps at **~10k req/s** (even with keep-alive + 100 reused sockets) and saturates node:http, bun-node:http, AND `Bun.serve()` equally at that ceiling:

| server (fixed node keep-alive load-gen, 100k reqs) | req/s |
|---|---|
| node — node:http | ~10,000 |
| bun — node:http | ~10,000 |
| bun — `Bun.serve()` | ~10,300 |

These are indistinguishable because the *client* is the bottleneck, not the servers. The published "Bun HTTP very high" numbers use dedicated load tools (`wrk` / `bombardier` / `oha`) that push 50–100k+ req/s and pipeline at the socket level — a regime this single-process client physically cannot reach. So: **I neither reproduced nor refuted the `Bun.serve()` advantage; I lack the load tool to see it.** What I can say is documented and load-tool-independent: **LuckyStack cannot use `Bun.serve()` anyway** — socket.io and the router are bound to `node:http`. Bun's single biggest HTTP win is architecturally off the table here, which is a concrete reason bun feels underwhelming *in this framework* specifically.

### RESOLVED with a real load tool (`oha`) — and it corrects the "~tie" above

The ~tie in the two tables above was a **measurement artifact**: my hand-rolled node client capped at ~10k req/s and saturated every server equally, so I could not see them differ. Installed `oha` (native Rust load generator, `winget install hatoo.oha`) and re-ran through the committed harness (`scripts/benchmark/runHttp.mjs`, 200 connections, 8 s, **median of 3 runs** — run-to-run variance was ~15–20 % under ~0.7 GB free RAM, so medians, not single runs):

| config | trivial `/` (req/s) | **realistic `/work`** (req/s) | p50 / p99 (work) |
|---|---|---|---|
| node + node:http | 20,695 | 7,317 | ~25 / ~38 ms |
| **bun + node:http** | 25,165 | **13,379** | ~14 / ~22 ms |
| bun + `Bun.serve()` | 32,845 | 15,254 | ~12 / ~19 ms |

`/work` returns a shaped 50-item JSON payload (dates, nested objects) — a realistic API response, not hello-world. Median ratios:

- **Switching runtime node → bun, keeping `node:http` (what the framework actually does): 1.2× on trivial, `1.83×` on realistic `/work`.** This is real, free, and fully available — the earlier "~tie" was wrong. bun's `node:http` compat layer beats node's, and the gap *widens* with real work because bun's faster JS execution (compute section: 1.6× JSON) compounds on top of the HTTP layer.
- **Going further to `Bun.serve()` (which the framework CANNOT — socket.io + router are bound to `node:http`): only ~1.14× more on `/work`.** On trivial hello-world the native server's edge is bigger (1.31×), but against a real payload most of the time is JSON building in JS, so its advantage narrows to ~12 %.

**So the architectural limitation costs ~12 % on realistic work, not the "10×" the ~10k figure suggested.** The big HTTP win — ~1.8× on realistic responses — comes from the *runtime switch alone* and the framework captures all of it on `node:http`. bun also posts consistently lower latency (p50/p99 roughly half node's on `/work`). This is the single most material runtime difference for a socket-first server, and it favours bun clearly — the earlier client-bottlenecked measurement had hidden it.

## Measurement bugs caught mid-run (recorded so the numbers above are trustworthy)

Three, and each is the reason a number above is worth anything:

1. **`npm ci` was failing fast and I nearly reported the failure as a result.** An early `npm ci` returned a tight, plausible **~1.7 s** — almost reported as "npm 8× faster." It was exiting 1 with `EUSAGE: package.json and package-lock.json … not in sync` (a stale lockfile). 1.7 s was the *error exit*, not an install. Caught by checking `node_modules` file count (0) instead of trusting the timer. The real `npm ci` is ~14 s.
2. **A flag asymmetry that unfairly slowed bun.** The first warm comparison gave npm `--offline` (pure cache) but bun no equivalent, so bun may have made network round-trips npm skipped. Fixed by switching to the lockfile mode both PMs optimize.
3. **A same-runtime HTTP test that flattered bun.** Measuring server+client on one runtime conflated bun's faster *client* with its server; isolating the server (fixed node load-gen) erased the gap. The "40% more req/s" would have been a real overclaim.

The recurring session lesson: a plausible number from a command whose *exit status, output, and confounds you didn't check* is not a measurement. (Lessons 0008/0009 — same shape.)

## Why these numbers look weaker than the online benchmarks

Reviewer, fairly: online benchmarks show bun crushing npm (one cites npm 28 min vs bun 47 s on a 1,847-dep monorepo) and rate Bun's HTTP "very high." My results are more muted. Both are true — they measure different axes, on a different platform, and this section reconciles them so the modest local result isn't mistaken for "bun isn't fast."

| Online benchmark shows | This benchmark measured | Why they differ |
|---|---|---|
| Install 28 min → 47 s (huge win) | Clean install: npm ~3× *faster* | Online = **cold** install (empty cache) where bun's win is **parallel downloads**; I used a **warm cache** to isolate the linker, excluding exactly that. Plus **Windows** (bun's weak FS platform) and a smaller tree. The 28 min npm figure is also a pathological worst case — real npm cold is minutes, not half an hour. |
| "Bun HTTP: very high" | node:http ~tie; `Bun.serve()` unmeasurable | Online = native **`Bun.serve()`** under a real load tool (wrk/oha). I measured **node:http** (what socket.io + the router require) and my client capped at ~10k req/s. See the HTTP section. |
| "Cold-start: very fast" | plain-JS startup ~tie (node 10 ms less) | bun's cold-start win is larger on Linux and for bigger apps; a tiny script on Windows is near-parity. |

Two honest framing points:
- **This is measured on bun's worst platform (Windows) under memory pressure (~0.7 GB free), with a hand-rolled load generator.** All three drag bun's *realized* numbers down relative to a Linux CI benchmark with `wrk`. My results are a fair picture of *this machine + this framework*, not of bun in the abstract.
- **The framework's architecture caps bun's upside here.** socket.io on `node:http` forecloses `Bun.serve()`; the router must stay on node entirely (WS proxy, B19). So even where bun's ceiling is high, LuckyStack can't spend it. That is a real, specific reason bun "valt mee" *for this stack* — not evidence bun is slow.

Where bun's win survived all of that and is real, measured, here: **runtime compute (JSON/sort 1.5–1.6×), TypeScript startup (~2.9× vs tsx), async scheduling (1.6–1.9×), and the everyday idempotent re-install (~10×).** Those are not nothing — they are just less dramatic than a cold-install-on-Linux headline.

## Three measurement bugs caught mid-run (recorded so the numbers above are trustworthy)

Each is the reason a number above is worth anything:

1. **`npm ci` was failing fast and I nearly reported the failure as a result.** An early `npm ci` returned a tight, plausible **~1.7 s** — almost reported as "npm 8× faster." It was exiting 1 with `EUSAGE: … not in sync` (a stale lockfile). 1.7 s was the *error exit*, not an install. Caught by checking `node_modules` file count (0) instead of trusting the timer. Real `npm ci` is ~14 s.
2. **A flag asymmetry that unfairly slowed bun.** The first warm comparison gave npm `--offline` but bun no equivalent, so bun may have made network round-trips npm skipped. Fixed by switching to the lockfile mode both PMs optimize.
3. **A same-runtime HTTP test that flattered bun.** Measuring server+client on one runtime conflated bun's faster *client* with its server; isolating the server erased the gap. "40% more req/s" would have been an overclaim.

The recurring session lesson: a plausible number from a command whose *exit status, output, and confounds you didn't check* is not a measurement. (Lessons 0008/0009 — same shape.)

## What this means for the framework's "both runtimes work" promise

Nothing changes — both still work (verified: 4/4 e2e matrix cells green, `smoke:ws` node 8/8). This is a performance profile, not a correctness result:

- **Prefer bun as the runtime — the HTTP win alone justifies it.** On the framework's real `node:http` path, bun serves a realistic response ~1.8× faster than node with roughly half the latency (measured via `oha`), on top of faster TS startup, JSON shaping, and async scheduling. To scale beyond one core you still run multiple instances behind the router either way, but each instance does more on bun.
- **Installer is a wash, scenario-dependent:** npm wins the clean install (~3× on Windows), bun wins the everyday repeat install (~10×). For a developer who installs once and re-runs often, bun feels faster day to day; for a cold CI job that always starts empty, npm is faster *on Windows* — re-measure on your CI's actual OS, where bun-on-Linux may flip it.
- The router still must run on **node** regardless (bun cannot proxy WebSockets — ledger 2026-07-15 B19, upstream bun#28396).
