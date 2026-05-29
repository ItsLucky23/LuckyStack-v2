//? Configurable thresholds for presence/AFK detection. Each installer's
//? tolerance for "the user temporarily disappeared" is different — a chat
//? app vs a turn-based-game vs a multiplayer editor all want different
//? grace periods. Defaults preserve the framework's prior hardcoded values
//? so existing installs keep their behavior until they opt to override.
//?
//? Read at call-time so projects can `registerPresenceConfig(...)` after
//? import. Same lazy pattern as `getProjectConfig()` in core.

export interface DisconnectTimers {
  /**
   * The user actively switched tabs (intentionalDisconnect signal). The
   * window is short because we expect them right back.
   */
  tabSwitchMs: number;
  /**
   * The transport closed cleanly (browser refresh, mobile lock screen,
   * networking blip). The window is generous because reconnects are common.
   */
  transportCloseMs: number;
  /**
   * Anything else (truly unexpected disconnect — process crash, OS-level
   * kill). The window is short because we don't expect a clean recovery.
   */
  defaultMs: number;
}

export interface PresenceConfig {
  disconnectTimers: DisconnectTimers;
  /**
   * Disconnect reasons treated as no-ops — we never tear down session state
   * or notify peers when the socket disconnects with one of these reasons.
   * Default: ['ping timeout'] (the client is almost certainly still there).
   */
  ignoreReasons: string[];
  /**
   * Disconnect reasons that grant the longer reconnect window
   * (`transportCloseMs`). Anything not in this list falls back to
   * `defaultMs`. Default: ['transport close', 'transport error'].
   */
  allowReasons: string[];
  /**
   * Idle time after which the built-in AFK activity event fires. Read by
   * the activity-event registry's default `'afk'` event. Set to 0 to
   * disable AFK detection entirely. Default: 5 minutes.
   */
  afkTimeoutMs: number;
}

export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  disconnectTimers: {
    tabSwitchMs: 20_000,
    transportCloseMs: 60_000,
    defaultMs: 2000,
  },
  ignoreReasons: ['ping timeout'],
  allowReasons: ['transport close', 'transport error'],
  afkTimeoutMs: 5 * 60_000,
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? DeepPartial<NonNullable<T[K]>> : T[K];
};

export type PresenceConfigInput = DeepPartial<PresenceConfig>;

let activeConfig: PresenceConfig = DEFAULT_PRESENCE_CONFIG;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const deepMerge = <T>(base: T, override: DeepPartial<T> | undefined): T => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value as DeepPartial<unknown>) : value;
  }
  return out as T;
};

export const registerPresenceConfig = (config: PresenceConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_PRESENCE_CONFIG, config);
};

export const getPresenceConfig = (): PresenceConfig => activeConfig;
