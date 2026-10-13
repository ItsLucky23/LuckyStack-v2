# Rate-limit strategy

Rate limiting is a shared abuse-control boundary for API, sync and authentication, not a substitute for authorization. A custom store must preserve atomic accounting under concurrent requests and across instances; an in-memory fallback does not provide a global quota. Account for store failures deliberately rather than silently describing an unavailable limit as enforced. See `../src/rateLimiter.ts`, `../../api/src/_shared/applyApiRateLimits.ts`, `../../login/src/authLockout.ts`.

IP-based buckets are only as trustworthy as the reverse-proxy configuration. Do not key authenticated users by raw bearer tokens; identities and configuration are resolved at request time. See `../src/resolveClientIp.ts` and `../src/projectConfig.ts` for policies/defaults.
