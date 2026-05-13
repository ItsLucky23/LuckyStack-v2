//? Middleware handler registry. The framework's `Middleware` + `Router`
//? components (in `./react/`) call the registered handler on every
//? navigation change to decide whether the user is allowed on the target
//? route. Consumer ships the actual logic in
//? `src/_functions/middlewareHandler.ts` and registers it from the client
//? bootstrap (typically `main.tsx`).

import type { BaseSessionLayout } from './sessionTypes';

export interface MiddlewareInput {
  location: string;
  searchParams: Record<string, string>;
  session: BaseSessionLayout | null;
}

export type MiddlewareResult =
  | { success: true; redirect?: undefined }
  | { success: false; redirect: string }
  | undefined;

export type MiddlewareHandler = (input: MiddlewareInput) => MiddlewareResult | Promise<MiddlewareResult>;

//? Default handler: deny by default with no redirect. Sends the user back
//? in browser history via the framework's caller. Consumers MUST register
//? their own handler for any non-public route.
const DEFAULT_HANDLER: MiddlewareHandler = () => undefined;

let activeHandler: MiddlewareHandler = DEFAULT_HANDLER;

export const registerMiddlewareHandler = (handler: MiddlewareHandler): void => {
  activeHandler = handler;
};

export const getMiddlewareHandler = (): MiddlewareHandler => activeHandler;
