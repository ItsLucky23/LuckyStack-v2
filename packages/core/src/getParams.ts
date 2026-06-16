import { IncomingMessage, ServerResponse } from "node:http";
import tryCatch from "./tryCatch";
import { getProjectConfig } from "./projectConfig";

interface getParamsType {
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  queryString?: string;
}

//? Shared error-response shape for the body parser's 413/400/415 branches.
//? Writes a JSON error envelope and resolves the outer promise with `null`
//? (the parser's "no usable body" signal). Extracted so the duplicated
//? "set header + writeHead + end(JSON) + resolve(null)" blocks live once.
const writeJsonErrorAndResolve = (
  res: ServerResponse,
  status: number,
  errorCode: string,
  resolve: (value: Record<string, unknown> | null) => void,
): void => {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify({
    status: 'error',
    httpStatus: status,
    message: errorCode,
    errorCode,
  }));
  resolve(null);
};

export default async function getParams({ method, req, res: _res, queryString }: getParamsType): Promise<Record<string, unknown> | null> {

  if (method === "GET") {
    //? if get request we return the query string as an object
    return Object.fromEntries(new URLSearchParams(queryString ?? ''));
  }

  //? if a POST, PUT or DELETE method we return the body as an object
  return new Promise((resolve) => {
    const contentType = req.headers['content-type'] ?? '';
    const contentLengthHeader = req.headers['content-length'];
    const declaredLength = typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : Number.NaN;
    const maxBodyBytes = getProjectConfig().http.requestBodyMaxBytes;

    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      writeJsonErrorAndResolve(_res, 413, 'api.payloadTooLarge', resolve);
      return;
    }

    //? Collect raw Buffer chunks and decode once at `end` — concatenating
    //? `chunk.toString()` per chunk corrupts multi-byte UTF-8 sequences that
    //? straddle a TCP chunk boundary.
    const chunks: Buffer[] = [];
    let bodySize = 0;
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > maxBodyBytes) {
        //? Write the 413 BEFORE tearing down the socket. `req` and `res` share one
        //? TCP socket, so destroying `req` first kills the connection before the
        //? 413 body is flushed and the client gets an empty/RST response instead.
        //? `writeJsonErrorAndResolve` sets `res.writableEnded`, which short-circuits
        //? the caller, so the destroy only needs to stop further inbound bytes.
        writeJsonErrorAndResolve(_res, 413, 'api.payloadTooLarge', resolve);
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => { void (async () => {
      const body = Buffer.concat(chunks).toString('utf8');

      //? here we parse the data depending on the content type
      //? if the content type is application/x-www-form-urlencoded we parse the data as a URLSearchParams object
      if (contentType.startsWith('application/x-www-form-urlencoded')) {
        const parseData = () => {
          const data = new URLSearchParams(body);
          return Object.fromEntries(data);
        };
        const [, response] = await tryCatch(parseData);
        if (response) {
          resolve(response); return;
        }

        writeJsonErrorAndResolve(_res, 400, 'api.invalidRequestFormat', resolve);
        return;
      }

      //? if the content type is application/json we parse the data as a JSON object
      if (contentType.startsWith('application/json')) {
        const parseData = (): unknown => {
          return JSON.parse(body || '{}');
        };
        const [, response] = await tryCatch(parseData);

        //? Reject array/scalar/null bodies — only plain objects are accepted.
        //? An attacker sending `[1,2,3]` or `42` could surface odd shapes in
        //? handlers that didn't expect them.
        if (response && typeof response === 'object' && !Array.isArray(response)) {
          resolve(response as Record<string, unknown>); return;
        }

        writeJsonErrorAndResolve(_res, 400, 'api.invalidRequestFormat', resolve);
        return;
      }

      //? Unknown content-type: don't attempt to interpret. Empty content-type
      //? bodies in particular were previously parsed as `{ body }` which let
      //? handlers mistake raw text for a typed payload.
      writeJsonErrorAndResolve(_res, 415, 'api.unsupportedMediaType', resolve);
    })(); });

    //? Request-stream error (e.g. a client RST mid-body on POST/PUT/DELETE).
    //? Mirror the SSE `markClosed` pattern: a broken request stream must NOT
    //? reject — a rejected promise here is voided by the http handler
    //? (`void handleHttpRequest(...)`) and becomes an unhandled rejection that
    //? crashes the worker. The connection is already gone, so we can't write a
    //? 4xx; resolve with `null` (the parser's "no usable body" signal) exactly
    //? like the 413/400/415 branches, letting the handler short-circuit
    //? cleanly. `resolve` after a prior settle is a no-op, so racing with
    //? `end`/the 413 path is safe.
    req.on('error', () => {
      resolve(null);
    });
  });
}
