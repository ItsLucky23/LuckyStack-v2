import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { describe, it, expect } from 'vitest';

import getParams from './getParams';

//? Genuine (but unconnected) request/response instances over an inert Socket —
//? keeps the types honest without any casts. `IncomingMessage` is itself a
//? Readable stream, so the test drives the 'data' / 'end' / 'error' events
//? getParams subscribes to via `req.emit(...)`.
const makeReq = (headers: Record<string, string> = {}): IncomingMessage => {
  const req = new IncomingMessage(new Socket());
  Object.assign(req.headers, headers);
  return req;
};

const makeRes = (req: IncomingMessage): ServerResponse => new ServerResponse(req);

describe('getParams request-stream error handling', () => {
  it('resolves null (no unhandled rejection) when the request stream errors mid-body', async () => {
    const req = makeReq({ 'content-type': 'application/json' });
    const res = makeRes(req);

    const promise = getParams({ method: 'POST', req, res });

    //? Simulate a client RST mid-body: a 'data' chunk then an 'error' event.
    req.emit('data', Buffer.from('{"a":'));
    req.emit('error', new Error('ECONNRESET'));

    //? The fix converts the stream error into the parser's "no usable body"
    //? signal (resolve(null)) instead of rejecting — a rejection here would be
    //? voided by `void handleHttpRequest(...)` and crash the worker.
    await expect(promise).resolves.toBeNull();
  });

  it('still parses a valid JSON body on the success path', async () => {
    const req = makeReq({ 'content-type': 'application/json' });
    const res = makeRes(req);

    const promise = getParams({ method: 'POST', req, res });

    req.emit('data', Buffer.from('{"hello":"world"}'));
    req.emit('end');

    await expect(promise).resolves.toEqual({ hello: 'world' });
  });
});
