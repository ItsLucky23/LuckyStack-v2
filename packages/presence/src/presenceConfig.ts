//? Configurable thresholds for presence/AFK detection. Each installer's
//? tolerance for "the user temporarily disappeared" is different — a chat
//? app vs a turn-based-game vs a multiplayer editor all want different
//? grace periods. Defaults preserve the framework's prior hardcoded values
//? so existing installs keep their behavior until they opt to override.
//?
//? Read at call-time so projects can `registerPresenceConfig(...)` after
//? import. Same lazy pattern as `getProjectConfig()` in core.

import { deepMerge, type DeepPartial } from '@luckystack/core';

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
   * (`transportCloseMs`). These represent NETWORK-level events (refresh,
   * connection blip) where the session should be preserved. Deliberate
   * client disconnects (`socket.disconnect()` → 'client namespace
   * disconnect') are intentionally NOT included — an explicit goodbye gets
   * the short `defaultMs` window before the session is torn down. Anything
   * not in this list falls back to `defaultMs`.
   * Default: ['transport close', 'transport error'].
   */
  allowReasons: string[];
  /**
   * Idle time after which the built-in AFK activity event fires. Read by
   * the activity-event registry's default `'afk'` event. Set to 0 to
   * disable AFK detection entirely. Default: 5 minutes.
   */
  afkTimeoutMs: number;
  /**
   * How often the server-side activity sampler walks every connected socket
   * and feeds an `ActivitySample` to `dispatchActivitySample` (which fires the
   * registered events). Smaller = faster AFK detection, more CPU. Should be
   * well below `afkTimeoutMs`. Set to 0 to disable the sampler. Default: 15s.
   */
  activitySampleIntervalMs: number;
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
  activitySampleIntervalMs: 15_000,
};

export type PresenceConfigInput = DeepPartial<PresenceConfig>;

let activeConfig: PresenceConfig = DEFAULT_PRESENCE_CONFIG;

export const registerPresenceConfig = (config: PresenceConfigInput): void => {
  activeConfig = deepMerge(DEFAULT_PRESENCE_CONFIG, config);
};

export const getPresenceConfig = (): PresenceConfig => activeConfig;
