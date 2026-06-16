import path from "node:path";
import { access } from 'node:fs/promises';
import fs from "node:fs";
import stream from "node:stream";
import { ServerResponse } from "node:http";
import { getUploadsDir } from './paths';
import { getAvatarConfig } from './avatarConfig';
import { getLogger } from './loggerRegistry';
import tryCatch from './tryCatch';
import { dispatchHook } from './hooks/registry';

//? Belt-and-suspenders: `path.basename` already strips traversal segments,
//? but explicitly allowlist the fileId character set so any future regression
//? in the upstream routing (e.g. URL-decoded embedded null) can't slip
//? through to the filesystem layer.
const FILE_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export const serveAvatar = async ({
  routePath,
  res,
}: {
  routePath: string;
  res: ServerResponse;
}) => {
  const uploadsFolder = getUploadsDir();
  const fileId = path.basename(routePath, path.extname(routePath));
  if (!fileId || !FILE_ID_REGEX.test(fileId)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
    return;
  }

  //? Access-control / audit seam: a `preAvatarServe` handler may veto the read
  //? (stop signal). We answer 404 — not 403 — so a private avatar's existence
  //? isn't disclosed to an unauthorized caller.
  const preDispatch = await dispatchHook('preAvatarServe', { routePath, fileId });
  if (preDispatch.stopped) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
    return;
  }

  const { formats, cacheControl } = getAvatarConfig();

  //? Try each configured format in order; first existing file wins. This
  //? lets an installer add `png` or `jpg` for backwards compatibility while
  //? still preferring `webp` for new uploads.
  for (const { extension, contentType } of formats) {
    const filePath = path.join(uploadsFolder, `${fileId}.${extension}`);
    const [accessError] = await tryCatch(() => access(filePath));
    if (accessError) continue;

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });
    //? Pipe with an error sink: once headers are flushed a read error can no
    //? longer be turned into a 5xx, so `pipeline` just tears the response down
    //? (destroys both streams) instead of letting the unhandled stream 'error'
    //? crash the worker. No double-write — we never write a body after this.
    stream.pipeline(fs.createReadStream(filePath), res, (pipelineError) => {
      if (pipelineError) {
        getLogger().debug('avatar: stream pipeline failed', { routePath, fileId, error: pipelineError });
      }
    });
    void dispatchHook('postAvatarServe', { routePath, fileId, extension, contentType });
    return;
  }

  getLogger().debug('avatar: file not found', { routePath, fileId });
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('File not found');
};
