import { resolveTestBaseUrl as resolveSharedTestBaseUrl } from '@luckystack/test-runner';
import { ports } from '../config.ports';

//? Root-app wrapper: the reusable resolver lives in @luckystack/test-runner;
//? this project's config.ports backend is the final fallback when no running dev
//? server has advertised an auto-incremented port.
export const resolveTestBaseUrl = (): string => resolveSharedTestBaseUrl({
  fallbackUrl: `http://localhost:${String(ports.backend)}`,
});
