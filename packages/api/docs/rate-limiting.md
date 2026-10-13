# API rate limiting

Per-route and cross-route IP limits defend different abuse patterns; neither substitutes for authorization. An authenticated caller's per-route quota should be associated with a server-validated identity rather than the replaceable token string. Anonymous and global-IP quotas rely on trustworthy proxy configuration: a spoofable forwarded address defeats that control. See `../src/_shared/rateLimitIdentity.ts`, `../src/_shared/applyApiRateLimits.ts`, `../../core/src/resolveClientIp.ts`.

Do not present a store failure as a successfully enforced quota. Consult `../../core/src/rateLimiter.ts` and `../../core/src/projectConfig.ts` for strategy and policy instead of copying limits or error envelopes here.
