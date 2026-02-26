import { generateTypeMapFile } from "../server/dev/typeMapGenerator.ts";
import { execSync } from "child_process";

const run = async () => {
  await generateTypeMapFile();
  try {
    execSync('npx prettier --write "src/_sockets/apiTypes.generated.ts" --ignore-path .prettierignore', { stdio: 'inherit' });
  } catch (err) {
    console.error('[TypeMapGenerator] Failed to format with prettier:', err);
  }
};

run();