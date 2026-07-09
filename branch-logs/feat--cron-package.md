# Branch log — feat/cron-package

## 2026-07-09 08:55 — @luckystack/cron: leader-elected scheduler package (nieuw, 16e package)

**User prompt:** cron-helper toevoegen aan het framework (goedgekeurd + requirements van de Workspaces-AI: leader-aware scheduling op de bestaande lease, Redis-backed job-registry, declaratieve `registerCronJob`, tenant-fan-out, overlap-guard + jitter, observability; aansluiten op bestáánde lease + Redis-adapter, geen tweede election-mechanisme).

**Wat ik deed:**
- Nieuw package `packages/cron` (@luckystack/cron 0.4.1): `registerCronJob({ name, schedule, handler, timezone?, jitterMs?, runOnStart?, perTenant?, runLeaseTtlMs? })` — cron-expressies via **croner** (bundled dep; bewust geen handgerolde parser i.v.m. DST/DOM-DOW-semantiek) of `{ everyMs }`-intervallen (min 1000ms), eager validatie.
- Scheduler-runtime (`scheduler.ts`): leader-loop op core's `acquireLease`/`renewLease` (lease `cron-scheduler`, TTL 30s / renew 10s, config via `registerCronConfig`), tick-loop 1s, lazy start bij eerste registratie (0 jobs = 0 timers), teardown via `preServerStop`. Geen catch-up; bij leiderschapswinst herberekenen vanaf "nu"; `runOnStart` max 1× per proces.
- Dedup/overlap: in-process running-guard + per-run lease `cron-run:<job>` (renewed op TTL/3) → leader-switch mid-run = skip i.p.v. double-fire. Contract: jobs idempotent (single-Redis best-effort lease).
- Per-tenant fan-out: `perTenant.tenants()` per run geresolved, handler per tenant met `ctx.tenant`, fouten per tenant geïsoleerd (eerste fout = run-error), optionele concurrency-pool.
- Observability: Redis-stats-hash per job (`getCronJobStats`: lastRun/duration/status/error + run/fail/skip-counters, elk via `formatKey` → multi-tenant-safe) + hooks `preCronRun` (veto-seam) / `postCronRun` (module augmentation op core HookPayloads).
- Integratie: `OPTIONAL_PACKAGES` + `OVERLAY_ORDER` ('cron' overlay-slot) in server; CLI `REGISTRY`-entry + manage-wizard toggle (`TOGGLE_IDS`/`TOGGLE_EFFECTS`/`TOGGLE_META`); build/publish-WAVES; root `tsconfig.server.json` paths+include; `npm install` (croner 9.1.0).
- Tests: 32 unit-tests (schedule-normalisatie/timezone/jitter; registry-validatie/replace/unregister; scheduler leiderschap/verlies+herwinst/enabled-switch/overlap-skip/run-lease-skip/veto/fout-stats/fan-out/runOnStart/runCronJobNow/shutdown) + bestaande CLI-test bijgewerkt (`transitions.apply.test.ts` toggles + cron). Alle 165 (cron+cli) groen; wave-build 17/17 OK; lint 0/0; ai:lint schoon.
- Docs: `packages/cron/{CLAUDE.md,README.md,CHANGELOG.md,docs/scheduler.md,LICENSE}`; `docs/ARCHITECTURE_EXTENSION_POINTS.md` §Scheduled jobs geamendeerd (package-first, bullmq/extern blijven de reach-past-patronen, History-blok); **ADR 0022** (herziening van "deliberately no cron" — materiële wijziging: core `lease.ts` bestaat nu en noemt cron als use-case); PACKAGE_OVERVIEW rij + cheatsheet + count 15→16; server/cli CLAUDE.md-vermeldingen; root CLAUDE.md snapshot-count.
- Regens: ai:decisions (20 op deze branch — 0020/0021 leven op debug/devtools-lag), ai:index, ai:capabilities.

**Files touched:** packages/cron/** (nieuw), packages/server/src/{capabilities,bootstrap}.ts, packages/cli/src/{registry,transitions,transitions.apply.test,commands/reconfigure}.ts, packages/cli/CLAUDE.md, packages/server/CLAUDE.md, scripts/{buildPackages,publishPackages}.mjs, tsconfig.server.json, docs/{ARCHITECTURE_EXTENSION_POINTS,PACKAGE_OVERVIEW}.md, docs/decisions/0022-*.md, CLAUDE.md, package-lock.json.

**Notes:** Bewuste scope-keuzes (in ADR 0022): `_cron/` file-conventie uitgesteld (devkit/codegen-werk); geen wizard-selectability (add-later via `npx luckystack add cron`); geen queue-semantiek (bullmq blijft het antwoord voor retries). Runtime-smoke in echte consumer volgt via verdaccio-e2e samen met de scaffold-manifest/ORM-werkstromen.
