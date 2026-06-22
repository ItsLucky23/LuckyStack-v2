// scripts/lintInvariants.mjs
//
// Diff-time enforcement of the machine-checkable subset of the CLAUDE.md
// contract. Where the three indexes describe the project and the decision log
// records the why, this turns a handful of always-on RULES from prose into an
// actual check, so an AI session (or a human) can't silently ship an `as any`,
// an arbitrary hex color, an untranslated user-facing string, or an unsafe
// request wrapper.
//
// REPORT-ONLY by default (mirrors the audit-* skills — never auto-fixes). A
// project opts a rule into *blocking* via a committed luckystack.invariants.json
// (`{ "block": ["no-as-any"], "warn": ["i18n-jsx"] }`). Per-line escape hatch:
//   <code> // luckystack-allow <rule>: <reason>
// documents a conscious deviation (Rule 3b) instead of disabling the hook.
//
// Modes:
//   (default)            scan ADDED lines of the staged git diff — only flags
//                        what THIS change introduces, not pre-existing debt.
//   --paths <f> [<f>...] scan whole files (used by the audit skill + tests).
//
// Exit code: 1 only if a BLOCKING-severity finding exists; warnings exit 0.
//
// Pure-Node ESM, no framework imports. The per-line checks are exported so the
// fixture tests can assert them without a git context.
//
// KEEP IN SYNC with packages/create-luckystack-app/template/scripts/
// lintInvariants.mjs (byte-for-byte duplicate ships to consumers).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIG_FILE = path.join(REPO_ROOT, "luckystack.invariants.json");

// ---------------------------------------------------------------------------
// Rule definitions. Each rule: id, a one-line description, an `applies(relPath)`
// gate, and a `find(text)` that returns a violation message or null. Kept
// regex-based (no TS-AST dep) to match the pure-Node generator family; `as any`
// is ALSO caught by eslint at `npm run lint` — this surfaces it at diff-time.
// ---------------------------------------------------------------------------

const isTs = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");
const isTsx = (p) => p.endsWith(".tsx");

const RULES = [
  {
    id: "no-as-any",
    description: "No `as any` / `as unknown as T` casts (Rule 21 + strict-typing policy).",
    applies: (p) => isTs(p) && !p.endsWith(".generated.ts"),
    find: (text) => {
      if (/\bas\s+unknown\s+as\b/.test(text)) return "`as unknown as T` cast — fix the typing source or regenerate artifacts, never cast.";
      if (/\bas\s+any\b/.test(text)) {
        const wrapper = /\b(apiRequest|syncRequest|upsertSyncEventCallback)\b/.test(text);
        return wrapper
          ? "`as any` on a request call — do NOT wrap apiRequest/syncRequest with unsafe types; rely on generated route/version types (Rule 21)."
          : "`as any` cast — use the real type or regenerate the type maps (Rule 21).";
      }
      return null;
    },
  },
  {
    id: "no-arbitrary-color",
    description: "Tailwind colors only from the `@theme` tokens in src/index.css — no arbitrary hex (Rule 14).",
    applies: (p) => isTsx(p) || p.endsWith(".css"),
    find: (text) => {
      // Arbitrary color utility: bg-[#fff], text-[#123456], border-[rgb(...)]
      if (/\b(?:bg|text|border|ring|fill|stroke|outline|decoration|from|via|to|shadow|accent|caret|divide|ring-offset)-\[(?:#|rgb|hsl)/i.test(text)) {
        return "arbitrary Tailwind color value — use a token from the src/index.css `@theme` block instead (Rule 14).";
      }
      // Raw hex literal inside a className template.
      if (/className\s*=\s*[`'"][^`'"]*#[0-9a-fA-F]{3,8}\b/.test(text)) {
        return "hardcoded hex color in className — use a `@theme` token (Rule 14).";
      }
      return null;
    },
  },
  {
    id: "i18n-jsx",
    description: "User-facing JSX text must go through `useTranslator` (Rule 13).",
    applies: (p) => isTsx(p),
    find: (text) => {
      const t = text.trim();
      if (!t || t.startsWith("//") || t.startsWith("*")) return null;
      if (/useTranslator|translate\s*\(|i18nKey|aria-|data-/.test(t)) return null;
      // JSX text node: >Human readable text< with no embedded expression.
      const m = t.match(/>\s*([^<>{}]*?[A-Za-z]{2,}[^<>{}]*?)\s*</);
      if (!m) return null;
      const inner = m[1].trim();
      // Skip single short tokens / all-caps consts / pure punctuation+digits.
      if (inner.length < 4 && !inner.includes(" ")) return null;
      if (/^[A-Z0-9_ ]+$/.test(inner) && !inner.includes(" ")) return null;
      return `hardcoded user-facing text "${inner.slice(0, 40)}" — wrap it in useTranslator (Rule 13).`;
    },
  },
];

const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Per-line scan (exported for tests). Honors an inline suppression:
//   ... // luckystack-allow <rule>: <reason>   (or `*` for all rules)
// ---------------------------------------------------------------------------

export const suppressedRules = (text) => {
  const out = new Set();
  const m = text.match(/\/\/\s*luckystack-allow\s+([A-Za-z0-9_,*-]+)/);
  if (!m) return out;
  for (const r of m[1].split(",")) out.add(r.trim());
  return out;
};

export const checkLine = (relPath, text) => {
  const suppressed = suppressedRules(text);
  const findings = [];
  for (const rule of RULES) {
    if (!rule.applies(relPath)) continue;
    if (suppressed.has(rule.id) || suppressed.has("*")) continue;
    const message = rule.find(text);
    if (message) findings.push({ rule: rule.id, message });
  }
  return findings;
};

// ---------------------------------------------------------------------------
// Config + severity
// ---------------------------------------------------------------------------

const loadConfig = async () => {
  const [err, raw] = await safe(fs.readFile(CONFIG_FILE, "utf8"));
  if (err) return { block: [], warn: [] };
  const [parseErr, parsed] = safeSync(() => JSON.parse(raw));
  if (parseErr || !parsed) return { block: [], warn: [] };
  return { block: Array.isArray(parsed.block) ? parsed.block : [], warn: Array.isArray(parsed.warn) ? parsed.warn : [] };
};

const safe = async (promise) => { try { return [null, await promise]; } catch (e) { return [e, null]; } };
const safeSync = (fn) => { try { return [null, fn()]; } catch (e) { return [e, null]; } };

// ---------------------------------------------------------------------------
// Input collection
// ---------------------------------------------------------------------------

// Added lines of the staged diff, as [{ file, line, text }]. Uses -U0 so only
// changed lines appear; tracks the +++ b/<path> header and the hunk @@ line
// numbers so each added line carries its real line number.
const stagedAddedLines = () => {
  let raw;
  try {
    raw = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color", "--diff-filter=ACM"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch { return []; }
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const m = line.match(/^\+\+\+ b\/(.*)$/);
      file = m ? m[1] : null;
      continue;
    }
    if (line.startsWith("@@")) {
      const m = line.match(/\+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      out.push({ file, line: lineNo, text: line.slice(1) });
      lineNo++;
    }
  }
  return out;
};

const wholeFileLines = async (relPaths) => {
  const out = [];
  for (const rel of relPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
    const [err, content] = await safe(fs.readFile(abs, "utf8"));
    if (err || content === null) continue;
    const relPosix = path.relative(REPO_ROOT, abs).replaceAll("\\", "/");
    content.split(/\r?\n/).forEach((text, i) => out.push({ file: relPosix, line: i + 1, text }));
  }
  return out;
};

// ---------------------------------------------------------------------------
// H-TWIN: transport-parity structural check
//
// Asserts that the API and sync transport-twin file pairs remain behaviourally
// aligned. Checked by static text scan (no TS compiler needed) — each twin is
// read once and tested for the presence of the documented hook names, shared
// helper calls, and rough pipeline ordering. A missing entry means a twin has
// silently lost a stage; the wrong order means auth/rate-limit sequencing has
// drifted. Violations are always BLOCK severity because divergence between
// socket and HTTP transports is a security regression.
//
// Intentional divergences that are NOT asserted here:
//   - preSocketMessage: socket-only hook (no HTTP equivalent)
//   - applyApiRateLimits skipGlobalIpBucket: HTTP-transport-only param
//   - ip field in apiAuthRejected payload: HTTP adds it, socket does not
// ---------------------------------------------------------------------------

// Hooks that BOTH api transport files must dispatch (billing order irrelevant
// for presence; ordering is checked separately for the security-sensitive pair).
const API_SHARED_HOOKS = [
  'apiAuthRejected',
  'preApiExecute',
  'postApiExecute',
  'preApiRespond',
  'transformApiResponse',
  'postApiRespond',
];

// Hooks that BOTH sync transport files must dispatch.
const SYNC_SHARED_HOOKS = [
  'preSyncAuthorize',
  'postSyncAuthorize',
  'preSyncValidate',
  'postSyncValidate',
  'preSyncExecute',
  'postSyncExecute',
  'preSyncFanout',
  'postSyncFanout',
  'preSyncRecipient',
  'rateLimitExceeded',
];

// Returns the byte-offset of the FIRST occurrence of `needle` in `haystack`,
// or -1 when not found.
const indexOf = (haystack, needle) => haystack.indexOf(needle);

// Returns true when `haystack` contains `needle`.
const contains = (haystack, needle) => haystack.includes(needle);

/** Checks one twin pair and returns any parity findings. */
const checkTwinPair = async ({
  socketFile,
  httpFile,
  sharedHooks,
  // Shared helper that BOTH files must call (e.g. `applyApiRateLimits`).
  sharedHelper,
  // In each file, this token must appear BEFORE the rate-limit helper call.
  // Used to verify auth → rate-limit ordering. May be undefined.
  authBeforeToken,
  // The rate-limit helper call token whose position we compare against authBeforeToken.
  rateLimitToken,
  rule,
}) => {
  const findings = [];

  const socketAbs = path.join(REPO_ROOT, socketFile);
  const httpAbs = path.join(REPO_ROOT, httpFile);

  const [errA, socketSrc] = await safe(fs.readFile(socketAbs, 'utf8'));
  const [errB, httpSrc] = await safe(fs.readFile(httpAbs, 'utf8'));

  if (errA) {
    findings.push({ file: socketFile, line: 1, rule, message: `transport-parity: cannot read file — ${errA.message}`, severity: 'block' });
    return findings;
  }
  if (errB) {
    findings.push({ file: httpFile, line: 1, rule, message: `transport-parity: cannot read file — ${errB.message}`, severity: 'block' });
    return findings;
  }

  // 1. Hook presence: every shared hook must appear in both files.
  for (const hook of sharedHooks) {
    const pattern = `'${hook}'`;
    if (!contains(socketSrc, pattern)) {
      findings.push({ file: socketFile, line: 1, rule, message: `transport-parity: socket handler missing dispatchHook('${hook}') — hook must appear on both transports.`, severity: 'block' });
    }
    if (!contains(httpSrc, pattern)) {
      findings.push({ file: httpFile, line: 1, rule, message: `transport-parity: HTTP handler missing dispatchHook('${hook}') — hook must appear on both transports.`, severity: 'block' });
    }
  }

  // 2. Shared rate-limit helper: both files must call it.
  if (sharedHelper) {
    if (!contains(socketSrc, sharedHelper)) {
      findings.push({ file: socketFile, line: 1, rule, message: `transport-parity: socket handler does not call shared helper '${sharedHelper}' — both transports must use it.`, severity: 'block' });
    }
    if (!contains(httpSrc, sharedHelper)) {
      findings.push({ file: httpFile, line: 1, rule, message: `transport-parity: HTTP handler does not call shared helper '${sharedHelper}' — both transports must use it.`, severity: 'block' });
    }
  }

  // 3. Pipeline-ordering check: authBeforeToken must appear before rateLimitToken.
  //    Only asserted when both tokens are present (a missing token is already caught above).
  if (authBeforeToken && rateLimitToken) {
    for (const [src, file] of [[socketSrc, socketFile], [httpSrc, httpFile]]) {
      const authPos = indexOf(src, authBeforeToken);
      const rlPos = indexOf(src, rateLimitToken);
      if (authPos !== -1 && rlPos !== -1 && authPos > rlPos) {
        findings.push({ file, line: 1, rule, message: `transport-parity: rate-limit helper '${rateLimitToken}' appears before auth token '${authBeforeToken}' — pipeline order must be auth → rate-limit.`, severity: 'block' });
      }
    }
  }

  return findings;
};

/** Top-level runner called from main(). Returns all parity findings. */
export const checkTransportParity = async () => {
  const all = [];

  // API twin pair: handleApiRequest.ts (socket) vs handleHttpApiRequest.ts (HTTP).
  //
  // Auth token: `apiAuthRejected` is dispatched in the auth stage on both
  // transports; it is a reliable anchor because no other stage fires it.
  // Rate-limit anchor: `applyApiRateLimits` is the shared helper; it always
  // appears AFTER the auth block in both files.
  const apiFindings = await checkTwinPair({
    socketFile: 'packages/api/src/handleApiRequest.ts',
    httpFile:   'packages/api/src/handleHttpApiRequest.ts',
    sharedHooks: API_SHARED_HOOKS,
    sharedHelper: 'applyApiRateLimits',
    authBeforeToken: "'apiAuthRejected'",
    rateLimitToken:  'applyApiRateLimits(',
    rule: 'transport-parity-api',
  });
  all.push(...apiFindings);

  // Sync twin pair: handleSyncRequest.ts (socket) vs handleHttpSyncRequest.ts (HTTP).
  //
  // The sync rate-limit helpers are per-transport inline functions, not a
  // shared module (inline twins of equivalent logic). We verify each contains
  // `checkRateLimit` (the core primitive both delegate to) rather than a named
  // shared helper.
  //
  // For pipeline-ordering we compare CALL SITE positions, not definition
  // positions. The function definitions appear early in the file but the actual
  // invocations are what determine pipeline order:
  //   socket: runSyncAuth( must precede applySyncRateLimits(
  //   http:   stageCheckAuth( must precede applyHttpSyncRateLimits(
  // We run two targeted checkTwinPair calls (one per ordering anchor pair)
  // then merge the presence-check results.
  const syncBaseFindings = await checkTwinPair({
    socketFile: 'packages/sync/src/handleSyncRequest.ts',
    httpFile:   'packages/sync/src/handleHttpSyncRequest.ts',
    sharedHooks: SYNC_SHARED_HOOKS,
    sharedHelper: 'checkRateLimit',
    // No cross-file ordering here — ordering is checked per-file below.
    authBeforeToken: undefined,
    rateLimitToken:  undefined,
    rule: 'transport-parity-sync',
  });
  all.push(...syncBaseFindings);

  // Socket handler: auth call site before rate-limit call site.
  const syncSocketOrder = await checkTwinPair({
    socketFile: 'packages/sync/src/handleSyncRequest.ts',
    httpFile:   'packages/sync/src/handleSyncRequest.ts',  // same file, order-only check
    sharedHooks: [],
    sharedHelper: undefined,
    authBeforeToken: 'runSyncAuth(',
    rateLimitToken:  'applySyncRateLimits(',
    rule: 'transport-parity-sync',
  });
  all.push(...syncSocketOrder);

  // HTTP handler: auth call site before rate-limit call site.
  const syncHttpOrder = await checkTwinPair({
    socketFile: 'packages/sync/src/handleHttpSyncRequest.ts',
    httpFile:   'packages/sync/src/handleHttpSyncRequest.ts',  // same file, order-only check
    sharedHooks: [],
    sharedHelper: undefined,
    authBeforeToken: 'stageCheckAuth(',
    rateLimitToken:  'applyHttpSyncRateLimits(',
    rule: 'transport-parity-sync',
  });
  all.push(...syncHttpOrder);

  return all;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Committed fixture assertions for the per-line checks (Rule 1a — the verifiable
// goal travels with the code). Run: `npm run ai:lint -- --selftest`.
const runSelfTest = () => {
  const cases = [
    ["as any flagged", checkLine("src/foo.ts", "const x = y as any;").some((f) => f.rule === "no-as-any")],
    ["as unknown as flagged", checkLine("src/foo.ts", "return z as unknown as Thing;").some((f) => f.rule === "no-as-any")],
    ["clean line ok", checkLine("src/foo.ts", "const total = a + b;").length === 0],
    ["suppression works", checkLine("src/foo.ts", "const x = y as any; // luckystack-allow no-as-any: legacy shim").length === 0],
    ["i18n jsx flagged", checkLine("src/p.tsx", "      <div>Welcome back to your dashboard</div>").some((f) => f.rule === "i18n-jsx")],
    ["translated jsx ok", checkLine("src/p.tsx", "      <div>{translate({ key: 'x' })}</div>").every((f) => f.rule !== "i18n-jsx")],
    ["arbitrary color flagged", checkLine("src/p.tsx", "className={`bg-[#ffffff] p-4`}").some((f) => f.rule === "no-arbitrary-color")],
    ["theme token ok", checkLine("src/p.tsx", "className={`bg-primary text-title p-4`}").every((f) => f.rule !== "no-arbitrary-color")],
    ["generated file skipped", checkLine("src/_sockets/apiTypes.generated.ts", "const x = y as any;").length === 0],
    ["request-wrapper message", checkLine("src/foo.ts", "apiRequest({ name: n as any });").some((f) => f.rule === "no-as-any" && /wrap/.test(f.message))],
  ];
  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) { failed++; console.error(`[ai:lint] selftest FAIL: ${name}`); } }
  console.log(`[ai:lint] selftest: ${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) { runSelfTest(); return; }
  const pathsIdx = argv.indexOf("--paths");
  const config = await loadConfig();

  const inputLines = pathsIdx !== -1
    ? await wholeFileLines(argv.slice(pathsIdx + 1))
    : stagedAddedLines();

  const findings = [];
  for (const { file, line, text } of inputLines) {
    for (const f of checkLine(file, text)) {
      const severity = config.block.includes(f.rule) ? "block" : "warn";
      findings.push({ file, line, rule: f.rule, message: f.message, severity });
    }
  }

  // H-TWIN: transport-parity structural check — always runs, not diff-scoped.
  // A missing hook or wrong pipeline order on either twin is a BLOCK violation.
  const parityFindings = await checkTransportParity();
  findings.push(...parityFindings);

  if (findings.length === 0) {
    console.log("[ai:lint] no invariant violations in scope.");
    console.log("[ai:lint] note: peer-dep-guard presence (configured-but-not-installed = hard boot crash) is a review-only invariant — not auto-checked here.");
    return;
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const blocking = findings.filter((f) => f.severity === "block");
  console.log(`[ai:lint] ${findings.length} invariant finding(s) (${blocking.length} blocking, ${findings.length - blocking.length} warning):\n`);
  for (const f of findings) {
    const tag = f.severity === "block" ? "BLOCK" : "warn ";
    console.log(`  [${tag}] ${f.file}:${f.line}  ${f.rule}`);
    console.log(`          ${f.message}`);
  }
  console.log("\n  Suppress a conscious deviation with:  // luckystack-allow <rule>: <reason>");
  console.log("  Make a rule blocking in luckystack.invariants.json (\"block\": [\"<rule>\"]).");

  if (blocking.length > 0) process.exit(1);
};

// Only run when invoked directly (the tests import checkLine without side effects).
const isEntry = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isEntry) {
  const [runErr] = await safe(main());
  if (runErr) {
    safeSync(() => console.error(`[ai:lint] fatal: ${runErr.stack ?? runErr.message ?? runErr}`));
    process.exit(1);
  }
}
