# keyv / cacheable supply-chain compromise — exposure check — 2026-08-04

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: exposure of this repository (all lockfiles + installed `node_modules` + local persistence artifacts) to the active npm compromise of the `keyv` and `cacheable` namespaces · Sources: Socket.dev advisory "Popular npm Packages in the keyv and Cacheable Namespaces Compromised in Active Supply Chain" (2026-08-04), local lockfile/`node_modules` inspection · Supersedes: —

Last updated: 2026-08-04

**Verdict: not exposed.** No compromised version is present in any lockfile or installed tree, and no persistence artifact was found. No remediation or credential rotation is required for this repository.

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| SC-01 | Root `package-lock.json` and installed tree carry `keyv@4.5.4`, `flat-cache@4.0.1`, `file-entry-cache@8.0.0` — all far below the compromised majors | INFO | false-positive | 2026-08-04 | 2026-08-04 | Name matches only; compromised versions are `keyv@6.0.0`, `flat-cache@6.1.24`, `file-entry-cache@11.1.7` |
| SC-02 | The three matching packages are transitive ESLint cache deps (`file-entry-cache` → `flat-cache` → `keyv`), not direct dependencies | INFO | false-positive | 2026-08-04 | 2026-08-04 | `npm ls` chain confirmed; nothing in this repo requests them directly |
| SC-03 | `cacheable`, `@cacheable/*`, `cacheable-request`, `cache-manager`, `@keyv/*`, `@thiennq/docs-viewer` are absent from the dependency graph entirely | INFO | false-positive | 2026-08-04 | 2026-08-04 | Whole package families never enter the tree |
| SC-04 | The five secondary lockfiles (`.smoke-test/app*`, `workspaces-handoff/ui-builder`) carry the same safe pinned versions | INFO | false-positive | 2026-08-04 | 2026-08-04 | Scanned all 6 lockfiles outside `node_modules` |
| SC-05 | No persistence artifact from the payload is present on this machine | INFO | false-positive | 2026-08-04 | 2026-08-04 | `~/.local/bin/gh-token-monitor.sh`, `~/.config/gh-token-monitor/`, `~/.config/systemd/user/gh-token-monitor.service` all absent; `.claude/settings.json` contains only the agent-teams env flag + empty permission arrays; no `.vscode/tasks.json`; the only `setup.mjs` in the tree is the legitimate `motion-dom` gesture util (525 B, dated 2026-06-03) |

## The incident

A compromised maintainer account (`Jaredwray`) published trojanized releases across the `keyv` and `cacheable` families on 2026-08-04. The malicious `preinstall` hook (`setup.mjs`) downloads a standalone Bun runtime, runs an obfuscated second stage that harvests cloud/CI credentials from AWS metadata endpoints (`169.254.169.254`, `169.254.170.2`), and then republishes trojanized versions of any other package the stolen npm token can reach — i.e. it self-propagates.

| Package | Compromised | Last safe |
| --- | --- | --- |
| `keyv`, `@keyv/redis`, `@keyv/sqlite`, `@keyv/mongo` | 6.0.0 | 5.x or earlier |
| `cacheable` | 2.5.1 | 2.5.0 |
| `@cacheable/net` | 2.1.1 | 2.1.0 |
| `@cacheable/node-cache` | 3.1.2 | 3.1.1 |
| `@cacheable/memory` | 2.2.1 | 2.2.0 |
| `@cacheable/utils` | 2.5.1 | 2.5.0 |
| `cacheable-request` | 13.0.20 | 13.0.19 |
| `flat-cache` | 6.1.24 | 6.1.23 |
| `file-entry-cache` | 11.1.7 | 11.1.6 |
| `cache-manager` | 7.2.10 | 7.2.9 |
| `@thiennq/docs-viewer` | 1.6.2 | 1.6.1 |

## Why this repo was not hit

The transitive `keyv`/`flat-cache`/`file-entry-cache` versions arrive through ESLint's cache chain and sit on old, stable majors that the attacker did not touch. Because they are pinned in committed lockfiles, a normal `npm ci` cannot drift into a 6.x release.

## Standing guidance

- Install with `npm ci` (lockfile-exact) rather than `npm install` while the maintainer account situation is unresolved.
- Do not bump ESLint or anything that would pull `file-entry-cache` into 11.x / `flat-cache` into 6.x / `keyv` into 6.x until the advisory reports the namespaces clean.
- If a fresh `npm install` is ever run against an unpinned range, re-run this exposure check before trusting the tree.

## How to re-run this check

```bash
node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync('package-lock.json','utf8'));const bad={'keyv':'6.0.0','@keyv/redis':'6.0.0','@keyv/sqlite':'6.0.0','@keyv/mongo':'6.0.0','cacheable':'2.5.1','@cacheable/net':'2.1.1','@cacheable/node-cache':'3.1.2','@cacheable/memory':'2.2.1','@cacheable/utils':'2.5.1','cacheable-request':'13.0.20','flat-cache':'6.1.24','file-entry-cache':'11.1.7','cache-manager':'7.2.10','@thiennq/docs-viewer':'1.6.2'};for(const [k,v] of Object.entries(l.packages||{})){const n=k.replace(/^.*node_modules\//,'');if(bad[n])console.log(n+'@'+v.version+(v.version===bad[n]?'  *** COMPROMISED ***':'  (safe)'));}"
```
