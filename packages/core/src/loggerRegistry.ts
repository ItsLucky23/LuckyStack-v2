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

export interface LoggerContext {
  [key: string]: unknown;
}

export interface Logger {
  debug: (message: string, context?: LoggerContext) => void;
  info: (message: string, context?: LoggerContext) => void;
  warn: (message: string, context?: LoggerContext) => void;
  error: (message: string, error?: unknown, context?: LoggerContext) => void;
}

const defaultLogger: Logger = {
  debug: (message, context) => {
    if (context !== undefined) console.debug(message, context);
    else console.debug(message);
  },
  info: (message, context) => {
    if (context !== undefined) console.info(message, context);
    else console.info(message);
  },
  warn: (message, context) => {
    if (context !== undefined) console.warn(message, context);
    else console.warn(message);
  },
  error: (message, error, context) => {
    if (error !== undefined && context !== undefined) console.error(message, error, context);
    else if (error !== undefined) console.error(message, error);
    else if (context !== undefined) console.error(message, context);
    else console.error(message);
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
    if (context !== undefined) console.log(message, context, 'cyan');
    else console.log(message, 'cyan');
  },
  info: (message, context) => {
    if (context !== undefined) console.log(message, context);
    else console.log(message);
  },
  warn: (message, context) => {
    if (context !== undefined) console.log(message, context, 'yellow');
    else console.log(message, 'yellow');
  },
  error: (message, error, context) => {
    if (error !== undefined && context !== undefined) console.log(message, error, context, 'red');
    else if (error !== undefined) console.log(message, error, 'red');
    else if (context !== undefined) console.log(message, context, 'red');
    else console.log(message, 'red');
  },
});

let activeLogger: Logger = defaultLogger;
let isRegistered = false;

export const registerLogger = (logger: Logger): void => {
  activeLogger = logger;
  isRegistered = true;
};

export const getLogger = (): Logger => activeLogger;

export const isLoggerRegistered = (): boolean => isRegistered;

//? Test-only helper — restore the default logger between integration tests.
//? Never call from production code.
export const resetLoggerForTests = (): void => {
  activeLogger = defaultLogger;
  isRegistered = false;
};
