import path from "node:path";
import { access } from 'node:fs/promises';
import fs from "node:fs";
import { ServerResponse } from "node:http";
import { getUploadsDir } from './paths';
import { getAvatarConfig } from './avatarConfig';
import { getLogger } from './loggerRegistry';

export const serveAvatar = async ({
  routePath,
  res,
}: {
  routePath: string;
  res: ServerResponse;
}) => {
  const uploadsFolder = getUploadsDir();
  const fileId = path.basename(routePath, path.extname(routePath));
  if (!fileId) return;

  const { formats, cacheControl } = getAvatarConfig();

  //? Try each configured format in order; first existing file wins. This
  //? lets an installer add `png` or `jpg` for backwards compatibility while
  //? still preferring `webp` for new uploads.
  for (const { extension, contentType } of formats) {
    const filePath = path.join(uploadsFolder, `${fileId}.${extension}`);
    try {
      await access(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    } catch {
      //? next format
    }
  }

  getLogger().debug('avatar: file not found', { routePath, fileId });
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('File not found');
};
