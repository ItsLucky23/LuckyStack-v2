//? Package sources import siblings without an extension (`./hooks/types`),
//? which `moduleResolution: "bundler"` accepts. tsc copies those specifiers
//? verbatim into the per-file .d.ts it emits, and a consumer on
//? `moduleResolution: "node16"/"nodenext"` cannot resolve them: with
//? skipLibCheck every LuckyStack type then silently becomes `any`.
//?
//? This rewrites relative specifiers in emitted declarations to the explicit
//? `.js` path Node resolution expects (`./hooks/types.js` or
//? `./hooks/index.js`), which bundler resolution also accepts. It rewrites
//? build output only; the sources keep their extensionless style.
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const resolveSpecifier = (fromFile, specifier) => {
  if (/\.(?:js|mjs|cjs|json)$/.test(specifier)) return specifier;
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (fs.existsSync(`${base}.d.ts`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(base, 'index.d.ts'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  return undefined;
};

const listDeclarations = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
};

//? Returns the specifiers that resolve to no emitted declaration; the caller
//? fails the build on any, because an unresolvable path is an `any` hole.
export const fixDeclarationSpecifiers = (distDir) => {
  const unresolved = [];
  for (const file of listDeclarations(distDir)) {
    const source = fs.readFileSync(file, 'utf8');
    //? TypeScript's own import scanner: finds import/export-from, `import()`
    //? types and `declare module` augmentations, and skips comments.
    const { importedFiles } = ts.preProcessFile(source, true, true);
    const edits = [];
    for (const { fileName, pos } of importedFiles) {
      if (!fileName.startsWith('./') && !fileName.startsWith('../')) continue;
      //? `pos` is the opening quote; the specifier text follows it.
      const start = pos + 1;
      if (source.slice(start, start + fileName.length) !== fileName) {
        unresolved.push(`${path.relative(process.cwd(), file)}: ${fileName} (unexpected position)`);
        continue;
      }
      const resolved = resolveSpecifier(file, fileName);
      if (!resolved) {
        unresolved.push(`${path.relative(process.cwd(), file)}: ${fileName}`);
        continue;
      }
      if (resolved !== fileName) edits.push({ start, end: start + fileName.length, text: resolved });
    }
    if (edits.length === 0) continue;
    let rewritten = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
    }
    fs.writeFileSync(file, rewritten);
  }
  return unresolved;
};
