import chokidar from "chokidar";
import { initializeApis, initializeFunctions, initializeSyncs } from "./loader";
import { shouldInjectTemplate, injectTemplate } from "./templateInjector";
import { generateTypeMapFile } from "./typeMapGenerator";
import { tryCatch } from "../functions/tryCatch";

// ----------------------------
// Watcher for Hot Reload + Type Generation
// ----------------------------

export const setupWatchers = () => {
  if (process.env.NODE_ENV !== "development") return;

  const handleAdd = async (path: string) => {
    console.log(path)
    const normalizedPath = path.replace(/\\/g, '/');

    // Check if this is a new empty file that needs a template
    if (shouldInjectTemplate(path)) {
      console.log(`[Watcher] New empty file detected: ${normalizedPath}`);
      const injected = await injectTemplate(path);
      if (injected) {
        // Don't continue processing - the template was just injected
        // The next 'change' event will handle it
        return;
      }
    }

    // Handle normal file additions
    handleChange(path);
  };

  const handleChange = async (path: string) => {
    console.log(path)
    const normalizedPath = path.replace(/\\/g, '/');

    // Skip if this is the generated type map file
    if (normalizedPath.includes('apiTypes.generated.ts')) {
      return;
    }

    if (normalizedPath.includes('_api/')) {
      // Reload the API handlers
      console.log(`[Watcher] Reloading API due to change in: ${normalizedPath}`);
      tryCatch(generateTypeMapFile);
      initializeApis();
    } else if (normalizedPath.includes('_sync/')) {
      console.log(`[Watcher] Reloading Sync due to change in: ${normalizedPath}`);
      initializeSyncs();
    }
  };

  const handleFunctionChange = (path: string) => {
    console.log(`[Watcher] Reloading Function due to change in: ${path.replace(/\\/g, '/')}`);
    initializeFunctions();
  };

  const handleDelete = (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');

    if (normalizedPath.includes('_api/')) {
      console.log(`[Watcher] API file deleted: ${normalizedPath}`);
      generateTypeMapFile();
      initializeApis();
    } else if (normalizedPath.includes('_sync/')) {
      console.log(`[Watcher] Sync file deleted: ${normalizedPath}`);
      initializeSyncs();
    }
  };

  // Watch the main source folders
  chokidar.watch('src', { ignoreInitial: true })
    .on('add', handleAdd)
    .on('change', handleChange)
    .on('unlink', handleDelete);

  // Watch functions separately
  chokidar.watch('server/functions', { ignoreInitial: true })
    .on('add', handleFunctionChange)
    .on('change', handleFunctionChange);

  // Generate initial type map on startup
  console.log('[Watcher] Generating initial frontend type map...');
  generateTypeMapFile();
};
