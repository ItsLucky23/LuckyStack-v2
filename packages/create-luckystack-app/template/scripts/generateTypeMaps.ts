import fs from "node:fs";
import path from "node:path";
import { tryCatch } from "@luckystack/core";
import { generateTypeMapFile } from "@luckystack/devkit";

const GENERATED_FILE = "src/_sockets/apiTypes.generated.ts";

//? Prettier runs in this process instead of through `npx prettier`: npx looked
//? the package up (or downloaded it) on every build, about 1.5 s of the
//? generation step, with an unpinned formatter version. A project that has not
//? added the `prettier` devDependency yet keeps an unformatted, valid file.
const formatGenerated = async (): Promise<void> => {
  const [importError, prettier] = await tryCatch(() => import("prettier"));
  if (importError || !prettier) {
    console.log("[TypeMapGenerator] prettier is not installed; add it as a devDependency to format the generated types.");
    return;
  }
  const file = path.resolve(GENERATED_FILE);
  const [formatError] = await tryCatch(async () => {
    const info = await prettier.getFileInfo(file, { ignorePath: ".prettierignore" });
    if (info.ignored) return;
    const options = await prettier.resolveConfig(file);
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, await prettier.format(source, { ...options, filepath: file }));
  });
  if (formatError) console.error("[TypeMapGenerator] Failed to format with prettier:", formatError);
};

const run = async () => {
  await generateTypeMapFile();
  await formatGenerated();
};

// Explicit exit: loading `@luckystack/devkit` transitively loads `@luckystack/core`,
// whose barrel connects to Redis on import. Without an explicit exit the dangling
// ioredis handle keeps the event loop alive and the script hangs.
run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[TypeMapGenerator] Generation failed:', error);
    process.exit(1);
  });
