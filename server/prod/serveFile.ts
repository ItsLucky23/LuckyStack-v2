import fs from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from 'node:url';
import { getPublicDir, tryCatch } from '@luckystack/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootFolder = path.join(__dirname, '../dist');

const resolveExistingPath = (paths: string[]): string | null => {
  for (const candidatePath of paths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
};

export const serveFavicon = (res: ServerResponse) => {
  //? here we get the favicon.ico file from the public folder and serve it to the client
  const publicFolder = resolveExistingPath([
    getPublicDir(),
    path.join(__dirname, '../public'),
    path.join(__dirname, '../../public'),
  ]);

  if (!publicFolder) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  const faviconPath = path.join(publicFolder, 'favicon.ico');
  if (!fs.existsSync(faviconPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  res.writeHead(200, { 'Content-Type': 'image/x-icon' });
  const stream = fs.createReadStream(faviconPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
    }
    res.end('Not Found');
  });
  stream.pipe(res);
}

export const serveFile = async (req: IncomingMessage | { url: string }, res: ServerResponse) => {
  //? Set nosniff on all responses from this handler (including 4xx/5xx)
  //? so the header is present even when serveFile is called outside the
  //? framework HTTP handler (e.g. in tests) which normally sets it globally.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  //? if request is / (root) we serve the index.html
  const url = req.url ? (req.url == '/' ? 'index.html' : req.url) : 'index.html';

  //? decodeURIComponent throws a URIError on malformed escapes (e.g. /assets/%ZZ);
  //? guard it so a bad URL becomes a 400 instead of an unhandled rejection that exits the worker.
  const [decodeError, decodedUrl] = await tryCatch(() => decodeURIComponent(url));
  if (decodeError || decodedUrl == null) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Bad Request");
  }

  const safePath = path.normalize(decodedUrl).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(rootFolder, safePath);

  //? Append the platform separator so a rootFolder of `/foo/dist` does not
  //? accidentally permit `/foo/dist-evil/` via prefix match.
  if (!filePath.startsWith(rootFolder + path.sep)) {
    //! here we avoid directory traversal attacks
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  //? here we check if the file extension or just the filename is in the list of files we dont want to serve
  //? a file that is in the list below should not be able to run this function in the first place cause we filter the routePath using zod before calling this function
  //? but if it passes somehow, we avoid it being served
  //? Use path.extname / path.basename (not .includes) to avoid false positives on
  //? directory or file names that coincidentally contain the blocked substring.
  const fileExt = path.extname(filePath);
  const fileName = path.basename(filePath);
  const BLOCKED_EXTENSIONS = new Set(['.env', '.map', '.ts', '.tsx', '.py']);
  const BLOCKED_BASENAMES = new Set([
    'server.js',
    'package.json',
    'package-lock.json',
    '.gitignore',
    'eslint.config.js',
    'postcss.config.mjs',
    'README.md',
    'redis.conf',
    'tailwind.config.js',
    'tsconfig.client.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'schema.prisma',
  ]);
  if (BLOCKED_EXTENSIONS.has(fileExt) || BLOCKED_BASENAMES.has(fileName) || fileName.startsWith('.env')) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }


  let contentType: string | null = 'text/html';

  //? here we get the content type of the file and serve it to the client
  //? if the file extension is not in the list below, we serve the index.html file
  switch (fileExt) {
    case '.html': { contentType = 'text/html'; break;
    }
    case '.css': { contentType = 'text/css'; break;
    }
    case '.js': { contentType = 'text/javascript'; break;
    }
    case '.json': { contentType = 'application/json'; break;
    }
    case '.png': { contentType = 'image/png'; break;
    }
    case '.jpg':
    case '.jpeg': { contentType = 'image/jpeg'; break;
    }
    case '.gif': { contentType = 'image/gif'; break;
    }
    case '.svg': {
      //? SVGs can contain embedded <script> tags. Serving with a
      //? `sandbox` CSP blocks script execution when loaded directly.
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      contentType = 'image/svg+xml';
      break;
    }
    case '.ico': { contentType = 'image/x-icon'; break;
    }
    default: {
      contentType = null;
    }
  }

  if (!contentType) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }

  const [readError, content] = await tryCatch(() => fs.promises.readFile(filePath));
  if (readError || !content) {
    if (url == 'index.html') {
      //? Dev hint: no build output yet. 503 (not 200) so healthchecks notice.
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Run 'npm run build' first.");
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
};
