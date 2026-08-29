// scripts/aiRefresh.mjs
//
// Rebuilds every AI-context artifact under docs/. These artifacts are a LOCAL
// CACHE, not repo content: they are gitignored, because each of them is a
// derived second answer to a question the code already answers, and a committed
// second answer is the one that drifts. With nothing in git there is nothing to
// drift FROM — no drift gate, no hook that stages generated output, no index
// diff in 200 of 411 commits.
//
// The generators are independent (none reads another's output) and each is a
// separate process, so they all run CONCURRENTLY: wall-clock is the slowest
// generator instead of the sum.
//
// Usage:
//   node scripts/aiRefresh.mjs                rebuild everything
//   node scripts/aiRefresh.mjs --if-missing   build only artifacts that are absent
//                                             (postinstall: a fresh clone / CI
//                                             runner gets working MCP lookups,
//                                             and a generator failure degrades
//                                             the tooling instead of breaking
//                                             the install)
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// aiRefresh.mjs (byte-for-byte duplicate ships to consumers).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

//? [generator script, the artifact it produces]. A generator that this project
//? doesn't have (the framework-only ones) is skipped silently, so the same file
//? serves the framework repo and every scaffold variant.
const GENERATORS = [
  ["generateAiIndex.mjs", "docs/AI_QUICK_INDEX.md"],
  ["generateAiCapabilities.mjs", "docs/AI_CAPABILITIES.md"],
  ["generateProjectIndex.mjs", "docs/AI_PROJECT_INDEX.md"],
  ["generateDecisionsIndex.mjs", "docs/AI_DECISIONS_INDEX.md"],
  ["generateLessonsIndex.mjs", "docs/AI_LESSONS_INDEX.md"],
  ["generateProductOverview.mjs", "docs/AI_PRODUCT_OVERVIEW.md"],
  ["generateGraph.mjs", "docs/ai-graph.json"],
];

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const exists = async (rel) => {
  const [err] = await safe(fs.stat(path.join(REPO_ROOT, rel)));
  return err === null;
};

const runGenerator = (script) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(SCRIPT_DIR, script)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => { out += String(chunk); });
  child.stderr.on("data", (chunk) => { out += String(chunk); });
  child.on("error", (error) => resolve({ script, ok: false, out: error.message }));
  child.on("close", (code) => resolve({ script, ok: code === 0, out: out.trim() }));
});

//? Filter a stage down to what should actually run: generators this project has,
//? minus (under --if-missing) the ones whose artifact is already on disk.
const plan = async (stage, ifMissing) => {
  const selected = [];
  for (const [script, artifact] of stage) {
    if (!(await exists(path.posix.join("scripts", script)))) continue;
    if (ifMissing && await exists(artifact)) continue;
    selected.push(script);
  }
  return selected;
};

const main = async () => {
  const ifMissing = process.argv.includes("--if-missing");
  const scripts = await plan(GENERATORS, ifMissing);
  const results = await Promise.all(scripts.map(runGenerator));

  if (results.length === 0) {
    console.log(ifMissing ? "[ai:refresh] all artifacts present — nothing to build." : "[ai:refresh] no generators found.");
    return;
  }

  for (const result of results) {
    if (result.out) console.log(result.out);
  }

  const failed = results.filter((r) => !r.ok);
  const label = `${results.length - failed.length}/${results.length}`;
  if (failed.length === 0) {
    console.log(`[ai:refresh] ${label} artifacts rebuilt.`);
    return;
  }

  //? Under --if-missing this runs from postinstall: report the failure loudly but
  //? exit 0, because a broken index is a degraded lookup, not a broken install.
  console.error(`[ai:refresh] ${label} rebuilt; failed: ${failed.map((f) => f.script).join(", ")}`);
  process.exit(ifMissing ? 0 : 1);
};

const [runErr] = await safe(main());
if (runErr) {
  console.error(`[ai:refresh] fatal: ${runErr.stack ?? runErr.message ?? runErr}`);
  process.exit(process.argv.includes("--if-missing") ? 0 : 1);
}
