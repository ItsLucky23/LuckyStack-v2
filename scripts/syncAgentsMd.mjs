#!/usr/bin/env node
//? Regenerates AGENTS.md from CLAUDE.md.
//?
//? WHY: AGENTS.md is the SAME contract, addressed to Codex instead of Claude
//? Code. It was hand-maintained, and hand-maintained duplicates drift — it sat
//? ~3 months and 800+ lines behind CLAUDE.md, which means one of the two agents
//? was reading rules that no longer applied. Deriving it removes the drift class
//? entirely: CLAUDE.md is the single source, this script stamps the audience.
//?
//? Run via `npm run ai:agents-md` (also in the pre-commit hook). Deterministic —
//? no timestamps — so a no-op commit leaves the file byte-identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(REPO_ROOT, 'CLAUDE.md');
const TARGET = path.join(REPO_ROOT, 'AGENTS.md');

//? The ONLY permitted divergence: who reads the file.
const AUDIENCE = ['Read on every prompt by Claude Code.', 'Read on every prompt by Codex.'];

const source = fs.readFileSync(SOURCE, 'utf8');
if (!source.includes(AUDIENCE[0])) {
  console.error(`[ai:agents-md] CLAUDE.md no longer contains the audience line "${AUDIENCE[0]}" — update scripts/syncAgentsMd.mjs.`);
  process.exit(1);
}

const rendered = source.replace(AUDIENCE[0], AUDIENCE[1]);
const previous = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
if (previous === rendered) {
  console.log('[ai:agents-md] AGENTS.md already in sync with CLAUDE.md.');
} else {
  fs.writeFileSync(TARGET, rendered);
  console.log('[ai:agents-md] regenerated AGENTS.md from CLAUDE.md.');
}
