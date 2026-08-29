// scripts/checkRecordIds.mjs
//
// Guards the IDENTITY of the numbered record layers: docs/decisions/ (ADRs) and
// docs/lessons/. A number is not a sequence position — it is the address that
// `//? @adr NNNN`, `relates: [NNNN]` and `get_decision(NNNN)` all resolve
// through. Nothing else in the toolchain notices when that address breaks.
//
// WHY THIS EXISTS. Two long-lived branches each allocate the next free number to
// a different decision. The slugs differ, so the FILENAMES differ, so git sees
// two ADDITIONS and merges them clean. Green pipeline, two `0089-*.md` in the
// tree, and every reference by number now lands on whichever file happens to
// sort first. Someone then "fixes" it by shifting a block of numbers — and that
// is when it becomes unrecoverable, because every reference written under the
// old scheme now points at a real, wrong decision. Nothing is broken: the number
// exists. Observed in the field: 13 duplicate ADR numbers, 32 shifted numbers,
// 6 `relates:` lines pointing at the wrong decision.
//
// WHAT IT CANNOT DO. It cannot detect a reference to an existing-but-wrong
// number — that is not mechanically knowable. It prevents the collision that
// leads to renumbering, which is the only real remedy. The matching rule lives
// in DECISION_MEMORY_PROTOCOL.md / LESSONS_PROTOCOL.md: a number is never
// reused and never shifted; on a collision the UNMERGED side moves.
//
// Pure Node, no dependencies, no writes — safe in a pre-commit hook.
//
// Usage:
//   node scripts/checkRecordIds.mjs              fast: the record files only
//   node scripts/checkRecordIds.mjs --backrefs   also `//? @adr NNNN` in source
//
// Exit code 1 on any finding.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// checkRecordIds.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

//? [directory, human label, frontmatter fields that hold numeric references]
const RECORD_SETS = [
  { dir: path.join(REPO_ROOT, "docs", "decisions"), label: "decision", refFields: ["relates", "supersedes", "superseded_by"] },
  { dir: path.join(REPO_ROOT, "docs", "lessons"), label: "lesson", refFields: ["relates", "supersedes", "superseded_by"] },
];

//? Roots scanned for `@adr NNNN` back-references under --backrefs.
const BACKREF_ROOTS = ["src", "server", "shared", "functions", "luckystack", "packages", "scripts"];
const BACKREF_EXT = /\.(ts|tsx|mjs|js|jsx)$/;
const RECORD_FILE_RE = /^(\d{4})-([A-Za-z0-9._-]+)\.md$/;

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));

const walkFiles = async (rootDir, predicate) => {
  const out = [];
  const [statErr, stat] = await safe(fs.stat(rootDir));
  if (statErr || !stat.isDirectory()) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const [readErr, entries] = await safe(fs.readdir(current, { withFileTypes: true }));
    if (readErr) continue;
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && predicate(entry.name)) out.push(abs);
    }
  }
  return out.sort();
};

//? Minimal YAML-frontmatter reader: only the shapes these records actually use
//? (`key: value` and `key: [a, b]`). Anything richer belongs in a real parser,
//? and a record that needs one is a record that has drifted from the template.
//? Split on /\r?\n/, never on "\n" alone. A CRLF checkout leaves a trailing \r
//? on every line, and `(.*)$` cannot match it (`.` excludes \r, and a
//? non-multiline `$` is end-of-input), so EVERY field read as absent — which
//? this checker cannot distinguish from a record that has no frontmatter. The
//? whole frontmatter half of the guard was therefore dead on Windows while CI
//? on Linux saw the truth, i.e. the platform that runs it on every commit was
//? the one it did not work on. See docs/lessons/0022.
const readFrontmatter = (text) => {
  if (!text.startsWith("---")) return {};
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const out = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
};

//? Numbers referenced by a frontmatter field. `relates: [0016, 0021]` -> [16, 21].
//? Non-numeric entries (a slug, a URL) are deliberately ignored: only a NUMBER
//? is an address this guard can verify.
const referencedNumbers = (raw) => {
  if (!raw) return [];
  const inner = raw.startsWith("[") ? raw.slice(1, raw.lastIndexOf("]")) : raw;
  return inner
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter((part) => /^\d{1,4}$/.test(part))
    .map((part) => Number.parseInt(part, 10));
};

const collectRecords = async (set) => {
  const [err, entries] = await safe(fs.readdir(set.dir, { withFileTypes: true }));
  if (err) return [];
  const records = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(RECORD_FILE_RE);
    if (!m) continue; // README.md and friends are not records
    const abs = path.join(set.dir, entry.name);
    const [readErr, text] = await safe(fs.readFile(abs, "utf8"));
    if (readErr) continue;
    records.push({
      file: relFromRepo(abs),
      name: entry.name,
      number: Number.parseInt(m[1], 10),
      slug: m[2],
      frontmatter: readFrontmatter(text),
      text,
    });
  }
  return records;
};

const checkSet = (set, records) => {
  const findings = [];
  const byNumber = new Map();
  for (const record of records) {
    const existing = byNumber.get(record.number);
    if (existing) existing.push(record);
    else byNumber.set(record.number, [record]);
  }

  // 1. Duplicate number — the collision that leads to renumbering.
  for (const [number, group] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length < 2) continue;
    findings.push(
      `duplicate ${set.label} number ${String(number).padStart(4, "0")} — ${group.length} files claim it:\n` +
      group.map((r) => `      ${r.file}`).join("\n") +
      `\n      Fix: the UNMERGED side moves to the next free number (published numbers never shift).`,
    );
  }

  // 2. In-file number/slug that disagrees with the filename.
  for (const record of records) {
    //? 0000 is the TEMPLATE, and its frontmatter is instructions to the author
    //? ("name: short-kebab-slug"), not a claim about itself. It still takes part
    //? in the duplicate-number check above — a second 0000 is a real collision.
    if (record.number === 0) continue;
    const heading = record.text.match(/^#\s*(\d{4})\b/m);
    if (heading && Number.parseInt(heading[1], 10) !== record.number) {
      findings.push(`${record.file}: heading says ${heading[1]} but the filename says ${String(record.number).padStart(4, "0")}`);
    }
    const id = record.frontmatter.id;
    if (id && /^\d{1,4}$/.test(id) && Number.parseInt(id, 10) !== record.number) {
      findings.push(`${record.file}: frontmatter id ${id} disagrees with the filename number`);
    }
    const fmName = record.frontmatter.name;
    if (fmName && fmName !== record.slug) {
      findings.push(`${record.file}: frontmatter name "${fmName}" disagrees with the filename slug "${record.slug}"`);
    }
  }

  // 3. Numeric cross-references that point at nothing.
  for (const record of records) {
    for (const field of set.refFields) {
      for (const referenced of referencedNumbers(record.frontmatter[field])) {
        if (byNumber.has(referenced)) continue;
        findings.push(`${record.file}: ${field} references ${set.label} ${String(referenced).padStart(4, "0")}, which does not exist`);
      }
    }
  }

  return findings;
};

const checkBackrefs = async (adrNumbers) => {
  const findings = [];
  const files = [];
  for (const root of BACKREF_ROOTS) {
    files.push(...await walkFiles(path.join(REPO_ROOT, root), (name) => BACKREF_EXT.test(name)));
  }
  let checked = 0;
  for (const abs of files) {
    const [err, text] = await safe(fs.readFile(abs, "utf8"));
    if (err) continue;
    const re = /@adr\s+(\d{1,4})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      checked += 1;
      const number = Number.parseInt(m[1], 10);
      if (adrNumbers.has(number)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      findings.push(`${relFromRepo(abs)}:${line}: @adr ${m[1]} does not exist`);
    }
  }
  return { findings, checked, scanned: files.length };
};

const main = async () => {
  const withBackrefs = process.argv.includes("--backrefs");
  const findings = [];
  let adrNumbers = new Set();
  let total = 0;

  for (const set of RECORD_SETS) {
    const records = await collectRecords(set);
    total += records.length;
    if (set.label === "decision") adrNumbers = new Set(records.map((r) => r.number));
    findings.push(...checkSet(set, records));
  }

  let backrefNote = "";
  if (withBackrefs) {
    const result = await checkBackrefs(adrNumbers);
    findings.push(...result.findings);
    backrefNote = `, ${result.checked} @adr backref(s) across ${result.scanned} source file(s)`;
  }

  if (findings.length > 0) {
    console.error(`[ai:check-ids] ${findings.length} problem(s):\n`);
    for (const finding of findings) console.error(`  - ${finding}`);
    console.error(`\n  A record number is an identity: never reuse it, never shift it.`);
    console.error(`  See docs/DECISION_MEMORY_PROTOCOL.md and docs/LESSONS_PROTOCOL.md.`);
    process.exit(1);
  }

  console.log(`[ai:check-ids] ok — ${total} record(s)${backrefNote}`);
};

const [runErr] = await safe(main());
if (runErr) {
  console.error(`[ai:check-ids] fatal: ${runErr.stack ?? runErr.message ?? runErr}`);
  process.exit(1);
}
