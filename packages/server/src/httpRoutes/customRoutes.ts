import { captureException, getLogger, tryCatch } from '@luckystack/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CustomRouteHandler, RouteContext } from '../types';
import { getCustomRoutes, getPreParamsCustomRoutes } from '../customRoutesRegistry';
import type { HttpRouteHandler } from './types';

const runHandler = async (
  handler: CustomRouteHandler,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  source: string,
): Promise<boolean> => {
  const [error, handled] = await tryCatch(() => handler(req, res, ctx));
  if (error) {
    //? Custom route handlers come from third-party overlay packages — one
    //? misbehaving handler must not crash the request loop or leak the
    //? error to the client. Surface to logger + Sentry, then return as
    //? handled so the caller short-circuits.
    getLogger().error(`${source} threw`, error, { routePath: ctx.routePath, method: ctx.method });
    captureException(error, { routePath: ctx.routePath, method: ctx.method, source });
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', errorCode: 'server.customRouteFailed' }));
    }
    return true;
  }
  return Boolean(handled) || res.writableEnded;
};

//? PRE-PARAMS phase: consumer routes registered with `{ phase: 'pre-params' }`,
//? dispatched BEFORE the body is parsed so the handler can read the raw `req`
//? stream (webhook HMAC verification, streaming/multipart uploads). A handler
//? that returns `false` without consuming the body falls through to the normal
//? pipeline. Runs after the framework's own pre-params fast-paths.
export const handlePreParamsCustomRoutes: HttpRouteHandler = async ({
  req,
  res,
  routePath,
  queryString,
  method,
  token,
}) => {
  const ctx: RouteContext = { routePath, method, queryString, token };
  for (const handler of getPreParamsCustomRoutes()) {
    const handled = await runHandler(handler, req, res, ctx, 'preParamsCustomRoute');
    if (handled) return true;
  }
  return false;
};

export const handleCustomRoutes: HttpRouteHandler = async ({
  req,
  res,
  options,
  routePath,
  queryString,
  method,
  token,
}) => {
  //? Two sources, evaluated in order: (1) handlers registered via
  //? `registerCustomRoute(...)` from overlay packages (`@luckystack/docs-ui`,
  //? etc.); (2) the legacy `customRoutes` option on
  //? `CreateLuckyStackServerOptions`. First one to return `true` (or end
  //? the response) wins.
  const ctx: RouteContext = { routePath, method, queryString, token };

  for (const handler of getCustomRoutes()) {
    const handled = await runHandler(handler, req, res, ctx, 'customRoutesRegistry');
    if (handled) return true;
  }
  if (options.customRoutes) {
    const handled = await runHandler(options.customRoutes, req, res, ctx, 'createServer.customRoutes');
    if (handled) return true;
  }
  return false;
};
