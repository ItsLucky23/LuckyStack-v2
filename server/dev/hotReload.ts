import chokidar from "chokidar";
import fs from "fs";
import { initializeApis, initializeFunctions, initializeSyncs } from "./loader";
import {
  shouldInjectTemplate,
  injectTemplate,
  isSyncServerFile,
  isSyncClientFile,
  getPairedSyncFile,
  extractClientInputFromFile,
  extractClientInputFromGeneratedTypes,
  extractSyncPagePath,
  extractSyncName,
  injectServerTemplateWithClientInput,
  updateClientFileForPairedServer,
  updateClientFileForDeletedServer,
  isEmptyFile
} from "./templateInjector";
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

      // Special handling for sync server files when client already exists
      if (isSyncServerFile(normalizedPath)) {
        const clientPath = getPairedSyncFile(normalizedPath);
        if (clientPath && fs.existsSync(clientPath) && !isEmptyFile(clientPath)) {
          // Extract clientInput types from existing client file
          const clientInputTypes = extractClientInputFromFile(clientPath);
          if (clientInputTypes) {
            console.log(`[Watcher] Found existing client file, migrating types to server: ${clientPath}`);
            // Inject server template with pre-filled clientInput from client
            await injectServerTemplateWithClientInput(path, clientInputTypes);
            // Regenerate types
            await tryCatch(generateTypeMapFile);
            // Update client file to use imported types + add serverData
            await updateClientFileForPairedServer(clientPath);
            initializeSyncs();
            return;
          }
        }
      }

      // Default template injection
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
      tryCatch(generateTypeMapFile);
      initializeSyncs();
    }
  };

  const handleFunctionChange = (path: string) => {
    console.log(`[Watcher] Reloading Function due to change in: ${path.replace(/\\/g, '/')}`);
    initializeFunctions();
  };

  const handleDelete = async (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');

    if (normalizedPath.includes('_api/')) {
      console.log(`[Watcher] API file deleted: ${normalizedPath}`);
      generateTypeMapFile();
      initializeApis();
    } else if (normalizedPath.includes('_sync/')) {
      console.log(`[Watcher] Sync file deleted: ${normalizedPath}`);

      // Special handling for sync server file deletion when client exists
      if (isSyncServerFile(normalizedPath)) {
        const clientPath = getPairedSyncFile(normalizedPath);
        if (clientPath && fs.existsSync(clientPath)) {
          console.log(`[Watcher] Server file deleted, updating client to standalone: ${clientPath}`);

          // Extract clientInput types from generated types file (server file is already deleted)
          const pagePath = extractSyncPagePath(normalizedPath);
          const syncName = extractSyncName(normalizedPath);
          const clientInputTypes = extractClientInputFromGeneratedTypes(pagePath, syncName);

          if (clientInputTypes) {
            await updateClientFileForDeletedServer(clientPath, clientInputTypes);
          } else {
            // Fallback if types couldn't be extracted
            await updateClientFileForDeletedServer(clientPath, '{\n    // Types were in _server.ts - please add them here\n  }');
          }
        }
      }

      generateTypeMapFile();
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
