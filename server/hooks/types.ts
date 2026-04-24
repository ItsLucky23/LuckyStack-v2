import type { BaseSessionLayout } from '@luckystack/login';

export interface HookStopSignal {
  stop: true;
  errorCode: string;
  httpStatus?: number;
}

// Handlers return undefined to continue or a stop signal to abort the main flow.
export type HookResult = undefined | HookStopSignal;

export type HookHandler<TPayload> = (payload: TPayload) => Promise<HookResult> | HookResult;

// --- API lifecycle ---

export interface PreApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: BaseSessionLayout | null;
}

export interface PostApiExecutePayload {
  routeName: string;
  data: Record<string, unknown>;
  user: BaseSessionLayout | null;
  result: unknown;
  error: Error | null;
  durationMs: number;
}

// --- Sync lifecycle ---

export interface PreSyncFanoutPayload {
  routeName: string;
  data: Record<string, unknown>;
  user: BaseSessionLayout | null;
  receiver: string;
  serverOutput: unknown;
}

export interface PostSyncFanoutPayload extends PreSyncFanoutPayload {
  recipientCount: number;
}

// --- Auth lifecycle (wired when @luckystack/login extracts) ---

export interface PostLoginPayload {
  userId: string;
  provider: string;
  isNewUser: boolean;
  token: string;
}

export interface PostRegisterPayload {
  userId: string;
  provider: string;
}

export interface PostLogoutPayload {
  userId: string | null;
  token: string | null;
}

// --- Session lifecycle (wired when session management extracts) ---

export interface PostSessionCreatePayload {
  token: string;
  user: BaseSessionLayout;
  persistent: boolean;
}

export interface PostSessionDeletePayload {
  token: string;
  userId: string | null;
}

// --- Presence lifecycle (wired when @luckystack/presence extracts) ---

export interface PrePresenceUpdatePayload {
  userId: string;
  status: string;
}

export interface PostPresenceUpdatePayload {
  userId: string;
  status: string;
}

// --- Hook map: name -> payload type ---

export interface HookPayloads {
  postLogin: PostLoginPayload;
  postRegister: PostRegisterPayload;
  postLogout: PostLogoutPayload;
  preApiExecute: PreApiExecutePayload;
  postApiExecute: PostApiExecutePayload;
  preSyncFanout: PreSyncFanoutPayload;
  postSyncFanout: PostSyncFanoutPayload;
  postSessionCreate: PostSessionCreatePayload;
  postSessionDelete: PostSessionDeletePayload;
  prePresenceUpdate: PrePresenceUpdatePayload;
  postPresenceUpdate: PostPresenceUpdatePayload;
}

export type HookName = keyof HookPayloads;
