//? Pluggable logger so framework code does not have to write directly to
//? stdout. The default implementation uses `console.{debug,info,warn,error}`
//? directly with no trailing color-code argument — that argument was only
//? meaningful when `initConsolelog()` (a dev-only monkey-patch) had been
//? installed, but the default logger needs to be safe in production too.
//?
//? Installers route framework logs to Pino / Winston / Datadog / etc. by
//? calling `registerLogger({ debug, info, warn, error })` once at boot,
//? mirroring the rest of the registry pattern in this package. Dev installs
//? that want colored output should call `registerLogger(createDevLogger())`.
//?
//? Read at call-time via `getLogger()` so registration order does not matter
//? — same contract as `getProjectConfig()` and friends.

import { createRegistry } from './createRegistry';

export type LoggerContext = Record<string, unknown>;

export interface Logger {
  debug: (message: string, context?: LoggerContext) => void;
  info: (message: string, context?: LoggerContext) => void;
  warn: (message: string, context?: LoggerContext) => void;
  error: (message: string, error?: unknown, context?: LoggerContext) => void;
}

const defaultLogger: Logger = {
  debug: (message, context) => {
    if (context === undefined) {console.debug(message);}
    else {console.debug(message, context);}
  },
  info: (message, context) => {
    if (context === undefined) {console.info(message);}
    else {console.info(message, context);}
  },
  warn: (message, context) => {
    if (context === undefined) {console.warn(message);}
    else {console.warn(message, context);}
  },
  error: (message, error, context) => {
    if (error !== undefined && context !== undefined) console.error(message, error, context);
    else if (error !== undefined) console.error(message, error);
    else if (context === undefined) {console.error(message);}
    else {console.error(message, context);}
  },
};

//? Dev-mode logger factory: wraps the default behavior with the colored
//? terminal output that `initConsolelog()` produces. Install via
//? `registerLogger(createDevLogger())` from a dev-only entry. Note: this
//? still depends on `initConsolelog()` having been called to interpret the
//? trailing color string — without it, the codes will appear as literal
//? text. Use the default logger when running in production or unsure.
export const createDevLogger = (): Logger => ({
  debug: (message, context) => {
    if (context === undefined) {console.log(message, 'cyan');}
    else {console.log(message, context, 'cyan');}
  },
  info: (message, context) => {
    if (context === undefined) {console.log(message);}
    else {console.log(message, context);}
  },
  warn: (message, context) => {
    if (context === undefined) {console.log(message, 'yellow');}
    else {console.log(message, context, 'yellow');}
  },
  error: (message, error, context) => {
    if (error !== undefined && context !== undefined) console.log(message, error, context, 'red');
    else if (error !== undefined) console.log(message, error, 'red');
    else if (context === undefined) {console.log(message, 'red');}
    else {console.log(message, context, 'red');}
  },
});

const registry = createRegistry<Logger>(defaultLogger);

export const registerLogger = (logger: Logger): void => {
  registry.register(logger);
};

export const getLogger = (): Logger => registry.get();

export const isLoggerRegistered = (): boolean => registry.isRegistered();

//? Test-only helper — restore the default logger between integration tests.
//? Never call from production code.
export const resetLoggerForTests = (): void => {
  registry.reset();
};
