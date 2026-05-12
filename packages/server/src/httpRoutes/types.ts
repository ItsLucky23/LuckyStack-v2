import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CreateLuckyStackServerOptions } from '../types';

export interface HttpRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  options: CreateLuckyStackServerOptions;
  routePath: string;
  queryString: string | undefined;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token: string | null;
  requestId: string;
  sessionCookieOptions: string;
  params: object;
}

export type HttpRouteHandler = (ctx: HttpRouteContext) => Promise<boolean>;
