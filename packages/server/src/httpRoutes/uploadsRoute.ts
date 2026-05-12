import { serveAvatar } from '@luckystack/core';
import type { HttpRouteHandler } from './types';

export const handleUploadsRoute: HttpRouteHandler = async ({ res, routePath }) => {
  if (!routePath.startsWith('/uploads/')) return false;
  await serveAvatar({ routePath, res });
  return true;
};
