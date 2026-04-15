export const serverRuntimeConfig = {
  auth: {
    oauthStateTtlSeconds: 60 * 10,
    oauthStateProjectNameFallback: 'luckystack',
  },
  http: {
    sessionCookieName: 'token',
    requestBodyMaxBytes: 1024 * 1024,
    stream: {
      queryParam: 'stream',
      enabledValue: 'true',
      connectedComment: ': connected',
    },
  },
  dev: {
    hotReloadDebounceMs: 120,
    watcherStabilityThresholdMs: 120,
    watcherPollIntervalMs: 20,
  },
} as const;
