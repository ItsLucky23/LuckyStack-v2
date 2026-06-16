//? Shared scanning + reporting helpers for the `check-env` / `check-i18n`
//? commands. Regex-based (mirrors the repo's `scripts/generate*.mjs` convention)
//? — no TypeScript compiler dependency, tolerant of parse failures so one weird
//? file never crashes a scan. All output goes to `dump/<KIND>_<hash>.log` so
//? each run is preserved and the log can be fed straight to an LLM.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

//? Directories/patterns never worth scanning for source usage.
const IGNORED_DIRS = new Set([
  'node_modules', 'dist', '.git', '.cache', 'dump', '.smoke-test',
  'build', 'coverage', '.next', '.turbo', '.vite', 'uploads',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface SourceFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to the project root (posix slashes). */
  rel: string;
  /** File contents (LF-normalized). */
  text: string;
  /** Lines (LF-split) for line-number lookups. */
  lines: string[];
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

//? Best-effort classification of an unexpected fs error. ENOENT (entry vanished
//? mid-scan) and EACCES/EPERM (permission) are expected on a live tree and are
//? skipped silently-but-logged; anything else is surfaced via debug log so a
//? genuinely-broken scan isn't invisible. Logs only when LUCKYSTACK_DEBUG is set
//? so normal runs stay quiet.
const debugFsError = (op: string, target: string, error: unknown): void => {
  if (!process.env.LUCKYSTACK_DEBUG) return;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    console.debug(`  (skip ${op} ${target}: ${code})`);
  } else {
    console.debug(`  (skip ${op} ${target}: unexpected`, error, ')');
  }
};

//? Depth-first directory walk: invokes `onFile(absPath, name)` for every file,
//? descending into any directory whose basename is not in `ignored`. Tolerant of
//? per-entry fs errors (a vanished/permission-denied entry is skipped, debug-
//? logged) so one weird path never crashes a scan. Shared by the source-file and
//? locale-file collectors.
export const walkDir = (
  root: string,
  ignored: ReadonlySet<string>,
  onFile: (abs: string, name: string) => void,
): void => {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      debugFsError('readdir', dir, error);
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(abs);
      } else if (entry.isFile()) {
        onFile(abs, entry.name);
      }
    }
  }
};

//? Walk the project for scannable source files, skipping vendored/build dirs and
//? generated artifacts. Returns files with their text preloaded.
export const collectSourceFiles = (root: string): SourceFile[] => {
  const out: SourceFile[] = [];
  walkDir(root, IGNORED_DIRS, (abs, name) => {
    if (!SOURCE_EXTENSIONS.has(path.extname(name))) return;
    if (name.includes('.generated.')) return;
    //? Skip tests — they use throwaway env vars + translation keys as fixtures
    //? that would pollute "used"/"missing" with noise that isn't real app usage.
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return;
    let raw: string;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch (error) {
      debugFsError('read', abs, error);
      return;
    }
    const text = raw.replaceAll('\r\n', '\n');
    out.push({ abs, rel: toPosix(path.relative(root, abs)), text, lines: text.split('\n') });
  });
  return out.toSorted((a, b) => a.rel.localeCompare(b.rel));
};

//? Every match of `pattern` (which MUST have a single capture group) across the
//? file, returned with the 1-based line number it occurred on. The regex is
//? cloned per file so the global lastIndex never leaks between files.
export interface Hit {
  value: string;
  file: string;
  line: number;
}

//? Offsets of every newline in `text` (the index of each `\n`). Used to map a
//? match index to a 1-based line via binary search, instead of re-slicing +
//? splitting the whole prefix per match (which is O(n²) on large, hit-dense
//? files). Computed once per file.
const newlineOffsets = (text: string): number[] => {
  const offsets: number[] = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    offsets.push(i);
  }
  return offsets;
};

//? 1-based line for `index`: count of newlines strictly before `index`, + 1.
//? `offsets` is ascending, so binary-search the first newline at-or-after `index`.
const lineForIndex = (offsets: number[], index: number): number => {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const offset = offsets[mid] ?? Number.POSITIVE_INFINITY;
    if (offset < index) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
};

export const matchAll = (files: SourceFile[], pattern: RegExp): Hit[] => {
  const hits: Hit[] = [];
  for (const file of files) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    const offsets = newlineOffsets(file.text);
    let m: RegExpExecArray | null;
    while ((m = re.exec(file.text)) !== null) {
      const captured = m[1];
      if (captured === undefined) continue;
      //? Line number = count of newlines before the match index, +1.
      const line = lineForIndex(offsets, m.index);
      hits.push({ value: captured, file: file.rel, line });
    }
  }
  return hits;
};

//? Group hit locations by their captured value: `value -> ["rel:line", ...]`.
export const groupLocations = (hits: Hit[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const hit of hits) {
    const list = map.get(hit.value) ?? [];
    list.push(`${hit.file}:${String(hit.line)}`);
    map.set(hit.value, list);
  }
  return map;
};

//? Build one dump-log report from a list of items. Each item is rendered to a
//? `## …` section; `count` lets a section represent more than one finding (e.g.
//? an env file with N unused keys counts N, not 1). The header builder receives
//? the total count so it can interpolate it, and the body falls back to
//? `emptyText` when there are no sections. Returns the per-run dump path plus the
//? total count for the CLI summary line. Shared by `check-env` + `check-i18n`,
//? whose "unused" + "missing" reports share this exact shape.
export interface ScanReport<T> {
  root: string;
  kind: string;
  items: T[];
  //? Render one item to a `## …` section. Return `null` to skip the item
  //? entirely (it contributes nothing to the body or the count).
  renderSection: (item: T) => { section: string; count: number } | null;
  header: (count: number) => string;
  emptyText: string;
}

export interface ScanReportResult {
  path: string;
  count: number;
}

export const buildScanReports = <T>(report: ScanReport<T>): ScanReportResult => {
  const sections: string[] = [];
  let count = 0;
  for (const item of report.items) {
    const rendered = report.renderSection(item);
    if (rendered === null) continue;
    count += rendered.count;
    sections.push(rendered.section);
  }
  const content = report.header(count) + (sections.join('\n\n') || report.emptyText);
  return { path: writeDumpLog(report.root, report.kind, content), count };
};

//? Ensure `<root>/dump/` exists and write `<KIND>_<hash>.log` into it. Returns
//? the path relative to root (posix) for the CLI pointer message.
export const writeDumpLog = (root: string, kind: string, content: string): string => {
  const dumpDir = path.join(root, 'dump');
  fs.mkdirSync(dumpDir, { recursive: true });
  const hash = crypto.randomBytes(4).toString('hex');
  const fileName = `${kind}_${hash}.log`;
  fs.writeFileSync(path.join(dumpDir, fileName), content, 'utf8');
  return `dump/${fileName}`;
};
