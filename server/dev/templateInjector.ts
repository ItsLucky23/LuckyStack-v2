import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Template Injector
 * 
 * Injects default templates into new empty files in _api and _sync folders.
 */


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// const rootFolder = path.join(__dirname, '../dist');

const templatesDir = path.join(__dirname, 'templates');

export const isEmptyFile = (filePath: string): boolean => {
  try {
    const stats = fs.statSync(filePath);
    return stats.size === 0;
  } catch {
    return false;
  }
};

export const isInApiFolder = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/_api/') && filePath.endsWith('.ts');
};

export const isInSyncFolder = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/_sync/') && filePath.endsWith('.ts');
};

export const isSyncServerFile = (filePath: string): boolean => {
  return filePath.endsWith('_server.ts');
};

export const isSyncClientFile = (filePath: string): boolean => {
  return filePath.endsWith('_client.ts');
};

/**
 * Calculate the relative path prefix (e.g., '../../../') to reach project root from a file
 * @param filePath - Absolute or relative path to the file
 * @returns The relative path prefix to reach project root
 */
export const calculateRelativePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');

  // Find the 'src/' part of the path
  const srcIndex = normalized.indexOf('src/');
  if (srcIndex === -1) {
    // Fallback: count from beginning if src not found
    console.warn(`[TemplateInjector] Could not find /src/ in path: ${filePath}`);
    return '../../../'; // default fallback
  }

  // Get path after 'src/' (e.g., 'examples/examples2/_api/file.ts')
  const relativePath = normalized.substring(srcIndex + 5); // +5 to skip '/src/'

  // Count segments (directories + filename)
  const segments = relativePath.split('/').filter(s => s.length > 0).length;

  // We need to go up `segments` levels to reach project root
  // e.g., 'examples/_api/file.ts' = 3 segments -> '../../../'
  // e.g., 'examples/examples2/_api/file.ts' = 4 segments -> '../../../../'
  return '../'.repeat(segments);
};

const getTemplate = (filePath: string): string | null => {
  let templateFile: string;

  if (isInApiFolder(filePath)) {
    templateFile = path.join(templatesDir, 'api.template.ts');
  } else if (isInSyncFolder(filePath)) {
    if (isSyncServerFile(filePath)) {
      templateFile = path.join(templatesDir, 'sync_server.template.ts');
    } else if (isSyncClientFile(filePath)) {
      templateFile = path.join(templatesDir, 'sync_client.template.ts');
    } else {
      console.log(`[TemplateInjector] Unknown sync file type: ${filePath}`);
      return null;
    }
  } else {
    return null;
  }

  try {
    let content = fs.readFileSync(templateFile, 'utf-8');

    // Replace path placeholders with computed relative paths
    const relPath = calculateRelativePath(filePath);
    const pattern = /\/\/\s*@ts-expect-error.*(?:\r?\n)(.*)\{\{REL_PATH\}\}/g;

    content = content.replace(pattern, (_, prefix) => {
      return `${prefix}${relPath}`;
    });
    // content = content.replace(/\{\{REL_PATH\}\}/g, relPath);

    return content;
  } catch (error) {
    console.error(`[TemplateInjector] Could not read template: ${templateFile}`, error);
    return null;
  }
};

export const injectTemplate = async (filePath: string): Promise<boolean> => {
  const template = getTemplate(filePath);

  if (!template) {
    return false;
  }

  try {
    fs.writeFileSync(filePath, template, 'utf-8');
    console.log(`[TemplateInjector] Injected template into: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[TemplateInjector] Failed to inject template: ${filePath}`, error);
    return false;
  }
};

export const shouldInjectTemplate = (filePath: string): boolean => {
  return (isInApiFolder(filePath) || isInSyncFolder(filePath)) && isEmptyFile(filePath);
};
