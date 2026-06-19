//? `luckystack add ai-docs` / `remove` — mirror of the scaffolder's `wireGraphMcp`:
//? registers the @luckystack/mcp graph server so AI agents can query the project's
//? dependency graph. Adds @luckystack/mcp as a devDep + a `luckystack` entry in
//? `.mcp.json`. Remove drops both.
//?
//? NOTE: the AI DOC TREE (root CLAUDE.md, docs/luckystack/, skills/, .claude/
//? commands/) is copied by `create-luckystack-app` from the framework repo at
//? scaffold time and is NOT bundled in this CLI's tarball — so `add ai-docs` wires
//? the runnable MCP layer but does not re-copy those docs. Re-scaffold (or copy
//? them from a fresh `npx create-luckystack-app`) if you need the full doc tree.

import fs from 'node:fs';
import path from 'node:path';
import {
  addDevDependency,
  detectJsonIndent,
  dropDependency,
  err,
  ok,
  resolveLuckyStackRange,
  runNpmInstall,
  toError,
  type ConsumerProject,
  type Result,
} from '../lib/project';
import type { AddOptions } from './addPresence';

const PKG = '@luckystack/mcp';

interface McpJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

//? Read + parse .mcp.json, returning the parsed data and the original raw string
//? (empty string when the file is missing/unparseable). The raw string is used to
//? detect and preserve the file's original indentation on write.
const readMcpJson = (file: string): { data: McpJson; raw: string } => {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return { data: parsed && typeof parsed === 'object' ? (parsed as McpJson) : {}, raw };
  } catch {
    return { data: {}, raw: '' };
  }
};

export const addAiDocs = (project: ConsumerProject, options: AddOptions): Result<void> => {
  const range = resolveLuckyStackRange(project.pkg, options.cliVersion);
  try {
    if (addDevDependency(project, PKG, range)) console.log(`• added ${PKG}@${range} to devDependencies`);
    else console.log(`• ${PKG} already in devDependencies`);
  } catch (error) {
    return err(toError(error));
  }

  const mcpFile = path.join(project.root, '.mcp.json');
  const { data, raw } = readMcpJson(mcpFile);
  const indent = detectJsonIndent(raw);
  data.mcpServers ??= {};
  if (data.mcpServers.luckystack) {
    console.log('• .mcp.json already registers the luckystack server — skipped.');
  } else {
    data.mcpServers.luckystack = { type: 'stdio', command: 'npx', args: ['@luckystack/mcp'] };
    try {
      fs.writeFileSync(mcpFile, `${JSON.stringify(data, null, indent)}\n`);
      console.log('• registered the luckystack graph server in .mcp.json');
    } catch (error) {
      return err(toError(error));
    }
  }

  if (options.install) {
    console.log('• running npm install …');
    if (!runNpmInstall(project.root, project.pkg)) console.warn('  npm install failed — run it manually to finish.');
  } else {
    console.log('• skipped npm install (--no-install) — run `npm install` to finish.');
  }
  console.log('\n✓ ai-docs (graph MCP) added. AI agents can now query the dependency graph via @luckystack/mcp.');
  console.log('  The doc tree (CLAUDE.md / docs/luckystack / skills) is NOT re-copied — re-scaffold if you need it.');
  return ok();
};

export const removeAiDocs = (project: ConsumerProject): Result<void> => {
  const mcpFile = path.join(project.root, '.mcp.json');
  if (fs.existsSync(mcpFile)) {
    const { data, raw } = readMcpJson(mcpFile);
    if (data.mcpServers && 'luckystack' in data.mcpServers) {
      const { luckystack: _removed, ...rest } = data.mcpServers;
      data.mcpServers = rest;
      try {
        fs.writeFileSync(mcpFile, `${JSON.stringify(data, null, detectJsonIndent(raw))}\n`);
        console.log('• removed the luckystack graph server from .mcp.json');
      } catch (error) {
        return err(toError(error));
      }
    }
  }
  try {
    //? dropDependency removes from BOTH dependencies and devDependencies, so the
    //? devDep added by addAiDocs (addDevDependency) is correctly cleaned up here.
    if (dropDependency(project, PKG)) console.log(`• removed ${PKG} from package.json`);
    else console.log(`• ${PKG} was not in package.json`);
  } catch (error) {
    return err(toError(error));
  }
  return ok();
};
