import { dev } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import type { PagePath, ApiName, ApiInput, ApiOutput } from './apiTypes.generated';

const env = import.meta.env;

//? if we use apiRequest function and the called api name starts with 1 of the names below we apply a abort controller
const abortControllers = new Map<string, AbortController>();
const abortControllerNames = ['get', 'fetch', 'load', 'is', 'has', 'list', 'all', 'search', 'view', 'retrieve'];

export interface apiRequestResponse {
  status: 'success' | 'error';
  result?: Record<string, any>;
  message?: string;
  messageParams?: Record<string, any>;
}

// Union of all API calls across all pages
type ApiCallUnion = {
  [P in PagePath]: {
    [N in ApiName<P>]: {
      name: N;
      data: ApiInput<P, N>;
      output: ApiOutput<P, N>;
      page: P;
    };
  }[ApiName<P>];
}[PagePath];

// All valid API names across all pages
type AllApiNames = ApiCallUnion['name'];

// Get data type for a name (union if name exists on multiple pages)
type DataForName<N extends AllApiNames> = Extract<ApiCallUnion, { name: N }>['data'];

// Get output type for a name (union if name exists on multiple pages)
type OutputForName<N extends AllApiNames> = Extract<ApiCallUnion, { name: N }>['output'];

// Check if data is required (not just Record<string, any>)
type IsDataRequired<T> = T extends Record<string, any>
  ? (keyof T extends never ? false : (string extends keyof T ? false : true))
  : true;

// Build the params type with data required or optional based on API definition
type ApiParams<N extends AllApiNames> = IsDataRequired<DataForName<N>> extends true
  ? { name: N; data: DataForName<N> }
  : { name: N; data?: DataForName<N> };

/**
 * Type-safe API request function.
 * 
 * @example Without page path (union types for duplicates):
 * ```typescript
 * // If 'jow' exists on multiple pages, data/output are unions
 * const result = await apiRequest({ name: 'jow', data: { ... } });
 * ```
 * 
 * @example With page path (exact types):
 * ```typescript
 * // Specify page path to get exact types for that page's API
 * const result = await apiRequest<'examples/examples2'>({ 
 *   name: 'jow', 
 *   data: { name: 'john' } 
 * });
 * ```
 */

// Overload 1: With page path specified - exact types for that page's APIs
export function apiRequest<P extends PagePath>(
  params: { name: ApiName<P>; data?: ApiInput<P, ApiName<P>> }
): Promise<ApiOutput<P, ApiName<P>>>;

// Overload 2: Without page path - uses union types for API names
// Data is required if the API expects specific input fields
export function apiRequest<N extends AllApiNames>(
  params: ApiParams<N>
): Promise<OutputForName<N>>;

// Overload 3: Special system APIs (logout, session)
export function apiRequest(
  params: { name: 'logout' | 'session' }
): Promise<apiRequestResponse>;

// Overload 4: Legacy/untyped fallback - accepts any string name
// Use this when enableTypeGeneration is false or for dynamic API names
export function apiRequest(
  params: { name: string; data?: any }
): Promise<apiRequestResponse>;

// Implementation (not exposed to TypeScript - only runtime)
export function apiRequest(params: any): Promise<any> {
  const { name } = params;
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

    const useAbortController = abortControllerNames.some((tempName) => (name as string).startsWith(tempName)) && env.VITE_SESSION_BASED_TOKEN != 'true';
    const pathname = window.location.pathname;
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
    socket.once(`apiResponse-${tempIndex}`, ({ result, message, status }: {
      result: any;
      message: string;
      status: "success" | "error";
    }) => {
      if (signal && signal.aborted) { return; }

      if (status === "error") {
        if (dev) {
          console.error('message:', message);
          toast.error(message);
        }
        return resolve({
          status,
          message
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