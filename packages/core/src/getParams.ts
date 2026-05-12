/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import { IncomingMessage, ServerResponse } from "node:http";
import tryCatch from "./tryCatch";
import { getProjectConfig } from "./projectConfig";

interface getParamsType {
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  queryString?: string;
}

export default async function getParams({ method, req, res: _res, queryString }: getParamsType): Promise<Record<string, unknown> | null> {

  if (method == "GET") {
    //? if get request we return the query string as an object
    return Object.fromEntries(new URLSearchParams(queryString || '')) as Record<string, string>;
  }

  //? if a POST, PUT or DELETE method we return the body as an object
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const contentLengthHeader = req.headers['content-length'];
    const declaredLength = typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : Number.NaN;
    const maxBodyBytes = getProjectConfig().http.requestBodyMaxBytes;

    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      _res.setHeader('Content-Type', 'application/json');
      _res.writeHead(413);
      _res.end(JSON.stringify({
        status: 'error',
        httpStatus: 413,
        message: 'api.payloadTooLarge',
        errorCode: 'api.payloadTooLarge',
      }));
      resolve(null); return;
    }

    //? we store the passed data chunks in a string
    let body = '';
    let bodySize = 0;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > maxBodyBytes) {
        _res.setHeader('Content-Type', 'application/json');
        _res.writeHead(413);
        _res.end(JSON.stringify({
          status: 'error',
          httpStatus: 413,
          message: 'api.payloadTooLarge',
          errorCode: 'api.payloadTooLarge',
        }));
        req.destroy();
        resolve(null); return;
      }

      body += chunk.toString();
    });

    req.on('end', async () => {
      //? here we parse the data depending on the content type
      //? if the content type is application/x-www-form-urlencoded we parse the data as a URLSearchParams object
      if (contentType.startsWith('application/x-www-form-urlencoded')) {
        const parseData = () => {
          const data = new URLSearchParams(body);
          return Object.fromEntries(data);
        }
        const [, response] = await tryCatch(parseData)
        if (response) {
          resolve(response); return;
        }

        _res.setHeader('Content-Type', 'application/json');
        _res.writeHead(400);
        _res.end(JSON.stringify({
          status: 'error',
          httpStatus: 400,
          message: 'api.invalidRequestFormat',
          errorCode: 'api.invalidRequestFormat',
        }));
        resolve(null); return;
      }

      //? if the content type is application/json we parse the data as a JSON object
      if (contentType.startsWith('application/json')) {
        const parseData = () => {
          return JSON.parse(body || '{}');
        }
        const [, response] = await tryCatch(parseData)

        //? Reject array/scalar/null bodies — only plain objects are accepted.
        //? An attacker sending `[1,2,3]` or `42` could surface odd shapes in
        //? handlers that didn't expect them.
        if (response && typeof response === 'object' && !Array.isArray(response)) {
          resolve(response as Record<string, unknown>); return;
        }

        _res.setHeader('Content-Type', 'application/json');
        _res.writeHead(400);
        _res.end(JSON.stringify({
          status: 'error',
          httpStatus: 400,
          message: 'api.invalidRequestFormat',
          errorCode: 'api.invalidRequestFormat',
        }));
        resolve(null); return;
      }

      //? Unknown content-type: don't attempt to interpret. Empty content-type
      //? bodies in particular were previously parsed as `{ body }` which let
      //? handlers mistake raw text for a typed payload.
      _res.setHeader('Content-Type', 'application/json');
      _res.writeHead(415);
      _res.end(JSON.stringify({
        status: 'error',
        httpStatus: 415,
        message: 'api.unsupportedMediaType',
        errorCode: 'api.unsupportedMediaType',
      }));
      resolve(null);
    })

    req.on('error', (error) => {
      reject(error);
    })
    // }

  });
}
