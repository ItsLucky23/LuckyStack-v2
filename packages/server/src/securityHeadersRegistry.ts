//? Security-headers builder registry. The framework ships sensible defaults
//? (Referrer-Policy, X-Frame-Options, X-XSS-Protection, X-Content-Type-Options)
//? read from `projectConfig.http.securityHeaders`. Consumers can register
//? a custom builder to add Content-Security-Policy, Strict-Transport-Security,
//? Permissions-Policy, or to override defaults per request.
//?
//? Resolution order:
//?   1. Built-in defaults from `projectConfig.http.securityHeaders`.
//?   2. Headers from the registered builder (override OR augment).
//?
//? A nullish return from the builder means "use defaults only". An object
//? merges on top of defaults (later wins per key).

import type { IncomingMessage } from 'node:http';
import { createRegistry } from '@luckystack/core';

export type SecurityHeadersBuilder = (req: IncomingMessage) => Record<string, string> | null | undefined;

//? Single-slot registry: one builder at a time, last-write-wins, `null` is the
//? unregistered baseline. Backed by core's `createRegistry` so the register /
//? read / reset triad isn't hand-rolled. The public `registerSecurityHeaders` /
//? `getSecurityHeadersBuilder` signatures below are preserved verbatim.
const builderRegistry = createRegistry<SecurityHeadersBuilder | null>(null);

/**
 * Register a custom security-headers builder. Called for every HTTP
 * request; return a plain object that gets merged on top of the framework
 * defaults. Use for Content-Security-Policy, HSTS, Permissions-Policy.
 *
 * Last-write-wins: subsequent calls replace the previous builder. Pass
 * `null` to unregister.
 */
export const registerSecurityHeaders = (builder: SecurityHeadersBuilder | null): void => {
  builderRegistry.register(builder);
};

/** Read the active builder (or null). */
export const getSecurityHeadersBuilder = (): SecurityHeadersBuilder | null => builderRegistry.get();
