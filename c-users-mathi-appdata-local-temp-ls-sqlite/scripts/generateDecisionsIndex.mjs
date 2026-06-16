// scripts/generateDecisionsIndex.mjs
//
// Regenerates docs/AI_DECISIONS_INDEX.md — the AI's queryable map of the
// project's DURABLE decisions ("why is it this way / why not Y"). This is the
// shareable, git-committed replacement for the per-developer ~/.claude memory
// palace: rationale + rejected alternatives travel with the repo, so every
// teammate and every fresh AI session inherits them.
//
// It is the fourth member of the deterministic index family, alongside
// AI_QUICK_INDEX.md (framework surfaces), AI_CAPABILITIES.md (installed
// packages + flat exports) and AI_PROJECT_INDEX.md (routes/pages/helpers).
// Distinct from branch-logs/ (per-prompt WHAT happened) and CLAUDE.md User
// Project Rules (always-on imperatives) — see docs/DECISION_MEMORY_PROTOCOL.md.
//
// Source of truth: docs/decisions/NNNN-slug.md (one ADR per file, frontmatter +
// narrative). The template seed (0000-template.md) is skipped.
//
// Pure-Node ESM. No framework imports — runs in pre-commit context before any
// TS build step. Deterministic (no timestamps) so a no-op commit leaves the
// output byte-identical. Inline safe/safeSync helpers mirror the pattern from
// generateProjectIndex.mjs / generateAiCapabilities.mjs.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// generateDecisionsIndex.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DECISIONS_DIR = path.join(REPO_ROOT, "docs", "decisions");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_DECISIONS_INDEX.md");

const safe = async (promise) => {
  try { return [null, await promise]; } catch (error) { return [error, null]; }
};

const safeSync = (fn) => {
  try { return [null, fn()]; } catch (error) { return [error, null]; }
};

const toPosix = (p) => p.replaceAll("\\", "/");
const relFromRepo = (abs) => toPosix(path.relative(REPO_ROOT, abs));

// ---------------------------------------------------------------------------
// Frontmatter parsing — a deliberately tiny YAML subset (key: value, and
// inline `[a, b]` arrays). Tolerant: a malformed block yields empty fields so
// a single weird file never crashes the index.
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const parseInlineArray = (raw) => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return null;
  const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
};

const parseFrontmatter = (src) => {
  const match = src.match(FRONTMATTER_RE);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rawValue = m[2].trim();
    const asArray = parseInlineArray(rawValue);
    out[key] = asArray !== null ? asArray : rawValue.replace(/^['"]|['"]$/g, "");
  }
  return out;
};

// Pull the first paragraph under a `## <Heading>` section, joined to a single
// line (consecutive non-empty lines up to the first blank line / next heading).
const extractSection = (src, heading) => {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\r\\n]))`, "mi");
  const m = src.match(re);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;
  const paragraph = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { if (paragraph.length > 0) break; else continue; }
    paragraph.push(t.replace(/^[-*]\s*/, ""));
  }
  return paragraph.length > 0 ? paragraph.join(" ") : null;
};

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const DECISION_FILE_RE = /^(\d{4})-([A-Za-z0-9][A-Za-z0-9-]*)\.md$/;

const scanDecisions = async () => {
  const [readErr, entries] = await safe(fs.readdir(DECISIONS_DIR, { withFileTypes: true }));
  if (readErr) return [];
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fm = entry.name.match(DECISION_FILE_RE);
    if (!fm) continue;
    const number = fm[1];
    if (number === "0000") continue; // template seed
    const abs = path.join(DECISIONS_DIR, entry.name);
    const [err, src] = await safe(fs.readFile(abs, "utf8"));
    if (err || src === null) continue;
    const front = parseFrontmatter(src) ?? {};
    rows.push({
      number,
      slug: fm[2],
      file: relFromRepo(abs),
      name: typeof front.name === "string" ? front.name : "",
      title: typeof front.title === "string" ? front.title : fm[2].replaceAll("-", " "),
      status: typeof front.status === "string" ? front.status : "accepted",
      date: typeof front.date === "string" ? front.date : "",
      deciders: Array.isArray(front.deciders) ? front.deciders : [],
      tags: Array.isArray(front.tags) ? front.tags : [],
      supersedes: Array.isArray(front.supersedes) ? front.supersedes : [],
      relates: Array.isArray(front.relates) ? front.relates : [],
      decision: extractSection(src, "Decision"),
    });
  }
  return rows.sort((a, b) => a.number.localeCompare(b.number));
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ").trim();

const STATUS_BADGE = {
  proposed: "🟡 proposed",
  accepted: "🟢 accepted",
  superseded: "⚪ superseded",
  deprecated: "🔴 deprecated",
};

const buildDocument = (rows) => {
  const parts = [];
  parts.push("# Decision Index");
  parts.push("");
  parts.push("> Auto-generated by `scripts/generateDecisionsIndex.mjs` — regenerate via `npm run ai:decisions`.");
  parts.push("> Hand edits will be overwritten — edit the decision files in `docs/decisions/` instead.");
  parts.push(">");
  parts.push("> The committed, team-shareable record of **why** this project is the way it is (and why");
  parts.push("> rejected alternatives were rejected). Read this at session start; open a decision file for");
  parts.push("> the full Context / Decision / Rejected-alternatives / Consequences. Distinct from");
  parts.push("> `branch-logs/` (what happened, per-prompt) and CLAUDE.md User Project Rules (always-on");
  parts.push("> imperatives). The AI records these automatically during sessions — see `docs/DECISION_MEMORY_PROTOCOL.md`.");
  parts.push("");
  parts.push(`## Decisions (${rows.length})`);
  parts.push("");
  if (rows.length === 0) {
    parts.push("_(none yet — the AI records the first durable decision automatically when one is made. See `docs/decisions/0000-template.md` + `docs/DECISION_MEMORY_PROTOCOL.md`.)_");
    parts.push("");
    return parts.join("\n");
  }
  parts.push(
    renderTable(
      ["#", "Title", "Status", "Tags", "Supersedes", "File"],
      rows.map((r) => [
        r.number,
        r.title,
        STATUS_BADGE[r.status] ?? r.status,
        r.tags.length ? r.tags.join(", ") : "—",
        r.supersedes.length ? r.supersedes.join(", ") : "—",
        `\`${r.file}\``,
      ]),
    ),
  );
  parts.push("");
  parts.push("## Summaries");
  parts.push("");
  for (const r of rows) {
    const meta = [
      `**${r.number}**`,
      r.status,
      r.tags.length ? `tags: ${r.tags.join(", ")}` : null,
      r.date || null,
    ].filter(Boolean).join(" · ");
    parts.push(`### ${r.number} — ${r.title}`);
    parts.push("");
    parts.push(meta);
    parts.push("");
    parts.push(r.decision ? r.decision : "_(no Decision section found — fill it in)_");
    parts.push("");
    parts.push(`→ \`${r.file}\``);
    parts.push("");
  }
  return parts.join("\n");
};

const renderTable = (header, rows) => {
  if (rows.length === 0) return "_(none)_";
  const out = [];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return out.join("\n");
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const main = async () => {
  const rows = await scanDecisions();
  const document = buildDocument(rows);

  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) {
    console.error(`[ai:decisions] failed to ensure docs directory: ${mkErr.message}`);
    process.exit(1);
  }
  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) {
    console.error(`[ai:decisions] failed to write ${OUTPUT_FILE}: ${writeErr.message}`);
    process.exit(1);
  }
  console.log(`[ai:decisions] generated ${relFromRepo(OUTPUT_FILE)} (${rows.length} decision${rows.length === 1 ? "" : "s"})`);
};

const [runErr] = await safe(main());
if (runErr) {
  safeSync(() => console.error(`[ai:decisions] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
