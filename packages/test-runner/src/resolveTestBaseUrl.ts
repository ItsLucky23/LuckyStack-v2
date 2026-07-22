import fs from 'node:fs';
import path from 'node:path';

const isProcessRunning = (pid: unknown): boolean => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

export interface ResolveTestBaseUrlOptions {
  /** Project root containing node_modules/.luckystack/dev-server.json. */
  cwd?: string;
  /** Used when no explicit override or valid live advertisement exists. */
  fallbackUrl?: string;
}

//? Shared by the framework repo and generated consumers so a dev backend that
//? auto-increments off its configured port does not turn connection failures
//? against the stale port into false test failures.
export const resolveTestBaseUrl = (
  options: ResolveTestBaseUrlOptions = {},
): string => {
  const explicit = process.env.TEST_BASE_URL;
  if (explicit) return explicit;

  try {
    const raw = fs.readFileSync(
      path.join(options.cwd ?? process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'),
      'utf8',
    );
    const info = JSON.parse(raw) as { port?: unknown; pid?: unknown };
    if (
      typeof info.port === 'number'
      && Number.isInteger(info.port)
      && info.port > 0
      && info.port <= 65_535
      && isProcessRunning(info.pid)
    ) {
      return `http://localhost:${String(info.port)}`;
    }
  } catch {
    //? No live dev advertisement — use the caller's config-derived fallback.
  }

  return options.fallbackUrl ?? 'http://localhost:80';
};
