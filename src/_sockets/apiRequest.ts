import { dev } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import type { PagePath, ApiName, ApiInput, ApiOutput } from './apiTypes.generated';
import { getApiMethod } from './apiTypes.generated';
import notify from "src/_functions/notify";

//? Abort controller logic:
//? - abortable: true → always use abort controller
//? - abortable: false → never use abort controller
//? - abortable: undefined → use abort controller for GET APIs (from generated types)
const abortControllers = new Map<string, AbortController>();

/**
 * Check if an API is a GET method using the generated type map.
 * Falls back to name inference if API not found in map.
 */
const isGetMethod = (pagePath: string, apiName: string): boolean => {
  const method = getApiMethod(pagePath, apiName);
  if (method) return method === 'GET';

  // Fallback: infer from name (only 'get' prefix)
  return apiName.toLowerCase().startsWith('get');
};

export interface apiRequestResponse {
  status: 'success' | 'error';
  result?: Record<string, any>;
  errorCode?: string;
  errorParams?: {
    key: string;
    value: string | number | boolean;
  }[];
  message?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = {} extends T ? false : true;

// ═══════════════════════════════════════════════════════════════════════════════
// Global API Params - Union of ALL valid API calls with proper data enforcement
// ═══════════════════════════════════════════════════════════════════════════════

// All possible API names across all pages
type AllApiNames = {
  [P in PagePath]: ApiName<P>
}[PagePath];

// Force expansion of types to clear aliases in tooltips
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// Get input type for an API name (union if exists on multiple pages)
type InputForName<N extends AllApiNames> = {
  [P in PagePath]: N extends ApiName<P> ? ApiInput<P, N> : never
}[PagePath];

// Get output type for an API name (union if exists on multiple pages)
type OutputForName<N extends AllApiNames> = {
  [P in PagePath]: N extends ApiName<P> ? ApiOutput<P, N> : never
}[PagePath];

// Build params type for a specific API name
type ApiParamsForName<N extends AllApiNames> =
  DataRequired<InputForName<N>> extends true
  ? { name: N; data: Prettify<InputForName<N>>; abortable?: boolean; disableErrorMessage?: boolean; }
  : { name: N; data?: Prettify<InputForName<N>>; abortable?: boolean; disableErrorMessage?: boolean; };

// ═══════════════════════════════════════════════════════════════════════════════
// Page-Specific Params (for exact types when duplicate names exist)
// ═══════════════════════════════════════════════════════════════════════════════

// Build params type for a specific page and API name
type PageApiParamsForName<P extends PagePath, N extends ApiName<P>> =
  DataRequired<ApiInput<P, N>> extends true
  ? { name: N; data: ApiInput<P, N>; abortable?: boolean; disableErrorMessage?: boolean; }
  : { name: N; data?: ApiInput<P, N>; abortable?: boolean; disableErrorMessage?: boolean; };

/**
 * Type-safe API request function.
 * 
 * @example
 * ```typescript
 * // Normal usage - shows all APIs with data validation
 * const result = await apiRequest({ name: 'publicApi', data: { message: 'hello' } });
 * // result is typed correctly for publicApi
 * 
 * // Page-specific for exact types when duplicates exist
 * await apiRequest<'examples', 'publicApi'>({ name: 'publicApi', data: { message: 'hello' } });
 * ```
 */

// Overload 1: Name-based inference - PRIMARY usage
// TypeScript infers N from the literal name value
// Use: apiRequest({ name: "publicApi", ... })
export function apiRequest<N extends AllApiNames>(
  params: ApiParamsForName<N>
): Promise<Prettify<OutputForName<N>>>;

// Overload 2: Explicit page + name - for duplicate API names across pages
// Both type params REQUIRED when specifying page
// Use: apiRequest<"examples", "publicApi">({ name: "publicApi", ... })
export function apiRequest<P extends PagePath, N extends ApiName<P>>(
  params: PageApiParamsForName<P, N>
): Promise<ApiOutput<P, N>>;

// System APIs (logout, session)
export function apiRequest(
  params: { name: 'logout' | 'session' }
): Promise<apiRequestResponse>;

// Implementation (not exposed to TypeScript - only runtime)
export function apiRequest(params: any): Promise<any> {
  const { name, disableErrorMessage = false } = params;
  let { data } = params;
  return new Promise(async (resolve, reject) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name");
        toast.error("Invalid name");
      }
      return resolve(null as any);
    }

    if (!data || typeof data !== "object") {
      data = {} as any;
    }

    if (!await waitForSocket()) { return resolve(null as any); }
    if (!socket) { return resolve(null as any); }

    //? Abort controller logic:
    //? - abortable: true → always use abort controller
    //? - abortable: false → never use abort controller  
    //? - abortable: undefined → smart default (GET APIs get abort controller)
    const pathname = window.location.pathname;
    const pagePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const isGet = isGetMethod(pagePath, name as string);
    const useAbortController = params.abortable === true || isGet;
    const fullname = (name as string) != 'session' && (name as string) != 'logout' ? `api${pathname}/${name}` : name;
    // example: api/games/boerZoektVrouw/getGameData

    let signal: AbortSignal | null = null;
    let abortFunc = () => { };

    if (useAbortController) {
      if (abortControllers.has(fullname as string)) {
        //? if we have an abort controller we abort it and create a new one
        const prevAbortController = abortControllers.get(fullname as string);
        prevAbortController?.abort();
      }
      //? here we create a new abort controller and add it to the map with the api fullname as the key
      const abortController = new AbortController();
      abortControllers.set(fullname as string, abortController);
      abortFunc = () => {
        if (signal) { signal.removeEventListener("abort", abortFunc); }
        reject(`Request ${fullname} aborted`)
      };
      //? here we bind the abortFunc to the abort event so it will be called when the abort controller is aborted
      signal = abortController.signal;
      signal.addEventListener("abort", abortFunc);
    }

    const tempIndex = incrementResponseIndex();
    socket.emit('apiRequest', { name: fullname, data, responseIndex: tempIndex });

    if (dev && (name as string) != 'session' && (name as string) != 'logout') { console.log(`Client API Request(${tempIndex}): `, { name, data }) }
    socket.once(`apiResponse-${tempIndex}`, ({ result, message, status, errorCode, errorParams }: {
      result: any;
      message: string;
      status: "success" | "error";
      errorCode?: string;
      errorParams?: {
        key: string;
        value: string | number | boolean;
      }[];
    }) => {
      if (signal && signal.aborted) { return; }

      if (status === "error") {
        if (!disableErrorMessage) {
          // toast.error(message)
          if (errorCode) {
            notify.error({ key: errorCode, params: errorParams })
          } else {
            notify.error({ key: message })
          }
        }
        return resolve({
          status,
          message,
          errorCode,
          errorParams
        } as any)
      }

      if (dev && (name as string) != 'session' && (name as string) != 'logout') { console.log(`Server API Response(${tempIndex}): `, { name, ...result }) }
      if (dev && (name as string) == 'session') { console.log(`Session result(${tempIndex}): `, result) }
      if (dev && (name as string) == 'logout') { console.log(`Logout result(${tempIndex}): `, result) }

      if (signal) {
        signal.removeEventListener("abort", abortFunc);
        abortControllers.delete(fullname as string);
      }

      resolve(result)
    });
  })
}