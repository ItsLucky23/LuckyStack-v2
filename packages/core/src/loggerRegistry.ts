//? Pluggable logger so framework code does not have to write directly to
//? stdout. The default implementation preserves the existing colored
//? `console.log('...', 'red')` shim behavior installed by `initConsolelog`
//? so nothing changes for projects that do not register a logger.
//?
//? Installers route framework logs to Pino / Winston / Datadog / etc. by
//? calling `registerLogger({ debug, info, warn, error })` once at boot,
//? mirroring the rest of the registry pattern in this package.
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
};

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
