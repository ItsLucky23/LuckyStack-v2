import { IncomingMessage, ServerResponse } from "node:http";
import tryCatch from "../../shared/tryCatch";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

type ParamsObject = Record<string, unknown>;

interface getParamsType {
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  queryString?: string;
}

const sendErrorResponse = (res: ServerResponse, statusCode: number, errorCode: string): void => {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  res.end(JSON.stringify({
    status: 'error',
    httpStatus: statusCode,
    message: errorCode,
    errorCode,
  }));
};

const isRecord = (value: unknown): value is ParamsObject => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

export default async function getParams({ method, req, res: _res, queryString }: getParamsType): Promise<ParamsObject | null> {

  if (method === "GET") {
    //? if get request we return the query string as an object
    return Object.fromEntries(new URLSearchParams(queryString ?? ''));
  }

  //? if a POST, PUT or DELETE method we return the body as an object
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    const contentLengthHeader = req.headers['content-length'];
    const declaredLength = typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      sendErrorResponse(_res, 413, 'api.payloadTooLarge');
      resolve(null); return;
    }

    //? we store the passed data chunks in a string
    let body = '';
    let bodySize = 0;
    req.on('data', (chunk: Buffer | string) => {
      const chunkText = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      bodySize += Buffer.byteLength(chunkText, 'utf8');
      if (bodySize > MAX_BODY_BYTES) {
        sendErrorResponse(_res, 413, 'api.payloadTooLarge');
        req.destroy();
        resolve(null); return;
      }

      body += chunkText;
    });

    req.on('end', () => {
      void (async () => {
        //? here we parse the data depending on the content type
        //? if the content type is application/x-www-form-urlencoded we parse the data as a URLSearchParams object
        if (contentType.startsWith('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(body)));
          return;
        }

        //? if the content type is application/json we parse the data as a JSON object
        if (contentType.startsWith('application/json')) {
          const [parseError, parsedValue] = await tryCatch(() => JSON.parse(body || '{}') as unknown);

          if (!parseError && isRecord(parsedValue)) {
            resolve(parsedValue);
            return;
          }

          sendErrorResponse(_res, 400, 'api.invalidRequestFormat');
          resolve(null);
          return;
        }

        resolve({ body });
      })().catch(reject);
    });

    req.on('error', (error) => {
      reject(error);
    });

  });
}
