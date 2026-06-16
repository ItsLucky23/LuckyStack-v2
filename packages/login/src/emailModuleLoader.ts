//? Shared lazy-loader for the optional `@luckystack/email` peer dep. Both
//? `forgotPassword.ts` and `emailChangeNotification.ts` need the SAME dynamic
//? import + the SAME minimal `EmailModule` shape, so the interface + the
//? `@ts-expect-error` import + the cast live here once (finding 37).
//?
//? IMPORTANT — this helper does NOT swallow a failed import. It resolves to the
//? module or REJECTS exactly like the raw `import(...)` would. That preserves
//? the two callers' DIFFERENT failure behavior verbatim:
//?   - `emailChangeNotification` awaits it directly (a load failure throws).
//?   - `forgotPassword` wraps it in `.catch(...)` (a load failure → null + warn).
//? Centralizing the catch here would change one of those — do NOT.

/** Minimal surface of `@luckystack/email` that the login orchestrators use. */
export interface EmailModule {
  sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;
}

/**
 * Dynamically import the optional `@luckystack/email` peer. Resolves to the
 * module, or REJECTS if the package is not installed (same as a bare
 * `import('@luckystack/email')`). Callers decide whether to `.catch(...)`.
 */
export const loadEmailModule = (): Promise<EmailModule> =>
  // @ts-expect-error optional peer dep — installed only when the consumer wires email sending
  import('@luckystack/email') as Promise<EmailModule>;
