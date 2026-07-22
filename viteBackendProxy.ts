import type { ProxyOptions } from 'vite';

//? Vite creates the underlying proxy from one options object, then stores a
//? shallow clone for request matching + `bypass`. Mutating only the object that
//? `bypass` receives therefore changes Vite's debug metadata, NOT the proxy's
//? actual upstream. Capture the original object through `configure` and update
//? both copies before Vite dispatches each HTTP request or WebSocket upgrade.
export type DynamicProxyOptions = Omit<ProxyOptions, 'target' | 'configure' | 'bypass'>;

export const isProcessRunning = (pid: unknown): boolean => {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    //? EPERM means the process exists but the caller cannot signal it.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

export const createDynamicProxyOptions = (
  resolveTarget: () => string,
  options: DynamicProxyOptions = {},
): ProxyOptions => {
  let liveProxyOptions: ProxyOptions | undefined;

  return {
    target: resolveTarget(),
    ...options,
    configure: (_proxy, configuredOptions) => {
      liveProxyOptions = configuredOptions;
    },
    bypass: (_req, _res, requestOptions) => {
      const target = resolveTarget();
      requestOptions.target = target;
      if (liveProxyOptions) liveProxyOptions.target = target;
    },
  };
};
