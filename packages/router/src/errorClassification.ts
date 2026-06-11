import type { PostProxyResponseErrorCause } from './hookPayloads';

// Node attaches `code` to system errors but the public Error type does not expose it,
// so we narrow via a structural property check rather than a cast.
export const readErrorCode = (err: Error): string | undefined => {
  if (!('code' in err)) return undefined;
  const candidate: unknown = err.code;
  return typeof candidate === 'string' ? candidate : undefined;
};

export const inferErrorCause = (code: string | undefined): PostProxyResponseErrorCause => {
  if (!code) return 'unknown';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  ) {
    return 'network';
  }
  return 'upstream-throw';
};
