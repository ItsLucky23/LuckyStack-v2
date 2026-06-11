import { getProjectConfig } from '@luckystack/core';

//? CC-5 — config-getter convenience lambdas shared by both API transports.
//? Read at call time (never at module load) so config registration order
//? and hot-reload both stay correct.

/** Gate for verbose per-request debug/warn/error logging. */
export const shouldLogDev = (): boolean => getProjectConfig().logging.devLogs;

/** Gate for `emitStream` payload logging. */
export const shouldLogStream = (): boolean => getProjectConfig().logging.stream;
