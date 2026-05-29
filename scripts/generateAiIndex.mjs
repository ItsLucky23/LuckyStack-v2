// scripts/generateAiIndex.mjs
//
// Regenerates docs/AI_QUICK_INDEX.md by scanning a curated set of sources:
//   - CLAUDE.md (root)
//   - docs/ARCHITECTURE_*.md
//   - packages/*/CLAUDE.md
//   - packages/*/docs/*.md
//   - .claude/commands/*.md
//   - skills/custom/*/SKILL.md
//
// Runs as a plain Node ESM script (no TypeScript build). We deliberately
// avoid importing framework-side tryCatch helpers here because they live in
// the TS source tree and would require a build step before this script
// can run during postinstall / CI. Instead we use a tiny inline tuple
// helper (`safe` / `safeSync`) at the top of the file so error handling
// still produces the [err, result] shape the framework prefers, without
// pulling in framework code paths.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_FILE = path.join(REPO_ROOT, "docs", "AI_QUICK_INDEX.md");
const TODO_BANNER = "STATUS: TODO PLACEHOLDER";

// ---------------------------------------------------------------------------
// Inline tryCatch substitutes (see module-header note for rationale).
// ---------------------------------------------------------------------------

const safe = async (promise) => {
  try {
    const result = await promise;
    return [null, result];
  } catch (error) {
    return [error, null];
  }
};

const safeSync = (fn) => {
  try {
    return [null, fn()];
  } catch (error) {
    return [error, null];
  }
};

// ---------------------------------------------------------------------------
// Tiny IO helpers
// ---------------------------------------------------------------------------

const readTextFile = async (absPath) => {
  const [err, content] = await safe(fs.readFile(absPath, "utf8"));
  if (err) {
    console.warn(`[ai:index] skip (read failed): ${path.relative(REPO_ROOT, absPath)} — ${err.message}`);
    return null;
  }
  return content;
};

const listDir = async (absPath) => {
  const [err, entries] = await safe(fs.readdir(absPath, { withFileTypes: true }));
  if (err) {
    return [];
  }
  return entries;
};

const fileExists = async (absPath) => {
  const [err] = await safe(fs.stat(absPath));
  return !err;
};

const splitLines = (text) => text.replace(/\r\n/g, "\n").split("\n");

// ---------------------------------------------------------------------------
// Markdown parsing helpers (single-responsibility, no regex magic beyond
// what's necessary).
// ---------------------------------------------------------------------------

const extractTitle = (content) => {
  for (const rawLine of splitLines(content)) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
};

const isHorizontalRule = (line) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line);

const extractFirstParagraph = (content) => {
  // Returns the first real content line after the `# Title` heading.
  // Order: blank lines, headings, and horizontal rules are skipped. Blockquote
  // lines are accepted (stripped of the leading `> `) so docs that style their
  // summary as a callout still surface a meaningful first line.
  const lines = splitLines(content);
  let sawTitle = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      sawTitle = true;
      continue;
    }
    if (!sawTitle) continue;
    if (isHorizontalRule(line)) continue;
    if (line.startsWith(">")) return line.replace(/^>\s*/, "").trim();
    return line;
  }
  return null;
};

const extractH2Sections = (content) => {
  // Returns array of { heading, firstLine }
  const lines = splitLines(content);
  const sections = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine;
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), firstLine: null };
      continue;
    }
    if (current && current.firstLine === null) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        current.firstLine = trimmed;
      }
    }
  }
  if (current) sections.push(current);
  return sections;
};

const extractFunctionIndex = (content) => {
  // Slice from "## Function Index" header to the next H2 heading.
  const lines = splitLines(content);
  const startIdx = lines.findIndex((l) => /^##\s+Function Index\b/i.test(l));
  if (startIdx === -1) return null;
  const slice = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    slice.push(line);
  }
  // Keep non-empty trimmed lines, prefer bullet/table entries.
  const entries = slice
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return entries;
};

const extractFrontmatter = (content) => {
  const lines = splitLines(content);
  if (lines[0] !== "---") return {};
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const match = lines[i].match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
};

const hasTodoBanner = (content) => content.includes(TODO_BANNER);

// ---------------------------------------------------------------------------
// Source scanners — each returns a structured object the renderer can use.
// ---------------------------------------------------------------------------

const scanRootClaudeMd = async () => {
  const filePath = path.join(REPO_ROOT, "CLAUDE.md");
  const content = await readTextFile(filePath);
  if (!content) return null;
  return {
    title: extractTitle(content) ?? "CLAUDE.md",
    sections: extractH2Sections(content),
    relPath: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
  };
};

const scanArchitectureDocs = async () => {
  const docsDir = path.join(REPO_ROOT, "docs");
  const entries = await listDir(docsDir);
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^ARCHITECTURE_.+\.md$/.test(entry.name)) continue;
    const filePath = path.join(docsDir, entry.name);
    const content = await readTextFile(filePath);
    if (!content) continue;
    results.push({
      file: entry.name,
      title: extractTitle(content) ?? entry.name,
      summary: extractFirstParagraph(content) ?? "(no description)",
      relPath: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
    });
  }
  results.sort((a, b) => a.file.localeCompare(b.file));
  return results;
};

const scanPackages = async () => {
  const pkgRoot = path.join(REPO_ROOT, "packages");
  const entries = await listDir(pkgRoot);
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(pkgRoot, entry.name);
    const aiIndexPath = path.join(pkgDir, "CLAUDE.md");
    const docsDir = path.join(pkgDir, "docs");

    let aiIndexData = null;
    if (await fileExists(aiIndexPath)) {
      const content = await readTextFile(aiIndexPath);
      if (content) {
        aiIndexData = {
          title: extractTitle(content) ?? entry.name,
          functionIndex: extractFunctionIndex(content) ?? [],
        };
      }
    } else {
      console.warn(`[ai:index] note: packages/${entry.name}/CLAUDE.md not present (skipped)`);
    }

    const subDocs = [];
    if (await fileExists(docsDir)) {
      const docEntries = await listDir(docsDir);
      for (const docEntry of docEntries) {
        if (!docEntry.isFile()) continue;
        if (!docEntry.name.endsWith(".md")) continue;
        const docPath = path.join(docsDir, docEntry.name);
        const content = await readTextFile(docPath);
        if (!content) continue;
        subDocs.push({
          file: docEntry.name,
          title: extractTitle(content) ?? docEntry.name,
          isTodo: hasTodoBanner(content),
          relPath: path.relative(REPO_ROOT, docPath).replace(/\\/g, "/"),
        });
      }
    }
    subDocs.sort((a, b) => a.file.localeCompare(b.file));

    results.push({
      name: entry.name,
      aiIndex: aiIndexData,
      docs: subDocs,
    });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
};

const scanSlashCommands = async () => {
  const cmdDir = path.join(REPO_ROOT, ".claude", "commands");
  const entries = await listDir(cmdDir);
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const filePath = path.join(cmdDir, entry.name);
    const content = await readTextFile(filePath);
    if (!content) continue;
    const fm = extractFrontmatter(content);
    const titleFromHeading = extractTitle(content);
    results.push({
      command: fm.name ?? entry.name.replace(/\.md$/, ""),
      description: fm.description ?? titleFromHeading ?? "(no description)",
      relPath: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
    });
  }
  results.sort((a, b) => a.command.localeCompare(b.command));
  return results;
};

const scanSkills = async () => {
  const skillsDir = path.join(REPO_ROOT, "skills", "custom");
  const entries = await listDir(skillsDir);
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    if (!(await fileExists(skillFile))) {
      console.warn(`[ai:index] note: skills/custom/${entry.name}/SKILL.md not present (skipped)`);
      continue;
    }
    const content = await readTextFile(skillFile);
    if (!content) continue;
    const title = extractTitle(content) ?? entry.name;
    const summary = extractFirstParagraph(content) ?? "(no description)";
    results.push({
      name: entry.name,
      title,
      summary,
      relPath: path.relative(REPO_ROOT, skillFile).replace(/\\/g, "/"),
    });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const escapeCell = (value) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

const renderTable = (header, rows) => {
  const out = [];
  out.push(`| ${header.join(" | ")} |`);
  out.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return out.join("\n");
};

const renderRootClaude = (rootClaude) => {
  if (!rootClaude) return "_(CLAUDE.md root not found)_";
  const rows = rootClaude.sections.map((s) => [s.heading, s.firstLine ?? "(no body)"]);
  return [
    `**${rootClaude.title}** — ${rootClaude.relPath}`,
    "",
    renderTable(["H2 section", "First line"], rows),
  ].join("\n");
};

const renderArchitectureDocs = (docs) => {
  const rows = docs.map((d) => [d.file, d.summary, d.relPath]);
  return renderTable(["Doc file", "Summary", "Location"], rows);
};

const renderFunctionInventory = (packages) => {
  const blocks = [];
  for (const pkg of packages) {
    blocks.push(`### \`${pkg.name}\``);
    if (!pkg.aiIndex) {
      blocks.push("- _(no `CLAUDE.md` yet)_");
      blocks.push("");
      continue;
    }
    if (pkg.aiIndex.functionIndex.length === 0) {
      blocks.push("- _(no `## Function Index` section yet)_");
      blocks.push("");
      continue;
    }
    for (const entry of pkg.aiIndex.functionIndex) {
      // Preserve existing bullet/table formatting if present; otherwise bullet-ify.
      if (entry.startsWith("-") || entry.startsWith("|") || entry.startsWith("*")) {
        blocks.push(entry);
      } else {
        blocks.push(`- ${entry}`);
      }
    }
    blocks.push("");
  }
  return blocks.join("\n");
};

const renderCompletionStatus = (packages) => {
  const rows = packages.map((pkg) => {
    const total = pkg.docs.length;
    const todo = pkg.docs.filter((d) => d.isTodo).length;
    const done = total - todo;
    return [pkg.name, String(total), String(done), String(todo)];
  });
  return renderTable(["Package", "Total stubs", "CONTENT done", "TODO remaining"], rows);
};

const renderSlashCommands = (commands) => {
  if (commands.length === 0) return "_(no slash commands found)_";
  const rows = commands.map((c) => [`/${c.command}`, c.description]);
  return renderTable(["Command", "Description"], rows);
};

const renderSkills = (skills) => {
  if (skills.length === 0) return "_(no custom skills found)_";
  const rows = skills.map((s) => [s.name, s.summary]);
  return renderTable(["Skill", "Purpose"], rows);
};

const buildDocument = (data) => {
  const parts = [];
  parts.push("# LuckyStack — AI Quick Index");
  parts.push("");
  parts.push(`> Auto-generated by \`scripts/generateAiIndex.mjs\` — regenerate via \`npm run ai:index\`.`);
  parts.push("> Hand edits will be overwritten — change the generator instead.");
  parts.push("");
  parts.push("## Where to find what");
  parts.push("");
  parts.push("### Root behaviour contract");
  parts.push("");
  parts.push(renderRootClaude(data.rootClaude));
  parts.push("");
  parts.push("### Architecture docs");
  parts.push("");
  parts.push(renderArchitectureDocs(data.architectureDocs));
  parts.push("");
  parts.push("## Function inventory across packages");
  parts.push("");
  parts.push(renderFunctionInventory(data.packages));
  parts.push("## Documentation completion status");
  parts.push("");
  parts.push(renderCompletionStatus(data.packages));
  parts.push("");
  parts.push("## Slash commands");
  parts.push("");
  parts.push(renderSlashCommands(data.slashCommands));
  parts.push("");
  parts.push("## Skills");
  parts.push("");
  parts.push(renderSkills(data.skills));
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("Consumer mag optioneel repomix gebruiken voor whole-repo AI consumption — valt buiten framework-scope.");
  parts.push("");
  return parts.join("\n");
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const main = async () => {
  const rootClaude = await scanRootClaudeMd();
  const architectureDocs = await scanArchitectureDocs();
  const packages = await scanPackages();
  const slashCommands = await scanSlashCommands();
  const skills = await scanSkills();

  const document = buildDocument({
    rootClaude,
    architectureDocs,
    packages,
    slashCommands,
    skills,
  });

  // Ensure docs/ exists before writing (it should, but be defensive).
  const [mkErr] = await safe(fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true }));
  if (mkErr) {
    console.error(`[ai:index] failed to ensure docs directory: ${mkErr.message}`);
    process.exit(1);
  }

  const [writeErr] = await safe(fs.writeFile(OUTPUT_FILE, document, "utf8"));
  if (writeErr) {
    console.error(`[ai:index] failed to write ${OUTPUT_FILE}: ${writeErr.message}`);
    process.exit(1);
  }

  const relOut = path.relative(REPO_ROOT, OUTPUT_FILE).replace(/\\/g, "/");
  console.log(
    `[ai:index] generated ${relOut} (${packages.length} packages, ${slashCommands.length} commands, ${skills.length} skills)`,
  );
};

const [runErr] = await safe(main());
if (runErr) {
  // The safeSync wrap is here to guarantee a clean exit-1 even if logging itself throws.
  safeSync(() => console.error(`[ai:index] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
  process.exit(1);
}
