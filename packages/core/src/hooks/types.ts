/**
 * Core hook contract: framework-generic payload shapes + augmentable registry.
 *
 * Feature packages (login/sync/api/presence/...) extend `HookPayloads` via
 * TypeScript module augmentation:
 *
 * ```ts
 * // packages/<feature>/src/hookPayloads.ts
 * declare module '@luckystack/core' {
 *   interface HookPayloads {
 *     myFeatureHook: { ... };
 *   }
 * }
 * export {};
 * ```
 *
 * Module-augmentation files MUST be in a tsconfig `include` path for TS to
 * pick up the merge; a side-effect import from the package's `index.ts`
 * (`import './hookPayloads';`) guarantees this.
 */

/**
 * Minimal session shape used inside core-owned hook payloads. Defined here
 * (instead of imported from `@luckystack/login`) so `@luckystack/core` stays
 * independent of login. Any concrete session type (`BaseSessionLayout`,
 * project-level `SessionLayout` extending Prisma User, etc.) is structurally
 * assignable to this shape.
 */
export interface HookSessionShape {
  id: string;
  token: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  admin?: boolean | null;
  language?: string | null;
  roomCodes?: string[];
}

export interface HookStopSignal {
  stop: true;
  errorCode: string;
  httpStatus?: number;
}

/** Handlers return undefined to continue, or a stop signal to abort the main flow. */
export type HookResult = undefined | HookStopSignal;

export type HookHandler<TPayload> = (payload: TPayload) => Promise<HookResult> | HookResult;

// --- Core-owned payloads (framework transport; concrete dispatch lives in @luckystack/api and @luckystack/sync) ---

export interface PreApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
}

export interface PostApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  result: unknown;
  error: Error | null;
  durationMs: number;
}

export interface PreSyncFanoutPayload {
  routeName: string;
  data: Record<string, unknown>;
  user: HookSessionShape | null;
  receiver: string;
  serverOutput: unknown;
}

export interface PostSyncFanoutPayload extends PreSyncFanoutPayload {
  recipientCount: number;
}

// --- Augmentable payload map ---

export interface HookPayloads {
  preApiExecute: PreApiExecutePayload;
  postApiExecute: PostApiExecutePayload;
  preSyncFanout: PreSyncFanoutPayload;
  postSyncFanout: PostSyncFanoutPayload;
}

export type HookName = keyof HookPayloads;
