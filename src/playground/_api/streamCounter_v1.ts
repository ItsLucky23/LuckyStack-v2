/* eslint-disable */
//? Playground: streams a fake counter to the originator over a configurable
//? duration. Demonstrates API-side `stream(...)` with throttling. Use the
//? "Stream" checkbox + this button on the playground to watch tokens roll in.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, ApiStreamEmitter } from '../../_sockets/apiTypes.generated';
import { sleep } from '@luckystack/core';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: {
    /** How many ticks to stream before completing. Default 10, max 200. */
    ticks?: number;
    /** ms between ticks. Default 100, min 20, max 2000. */
    intervalMs?: number;
  };
  user: SessionLayout | null;
  functions: Functions;
  stream: ApiStreamEmitter;
}

export const main = async ({ data, stream }: ApiParams): Promise<ApiResponse> => {
  const ticks = Math.max(1, Math.min(200, data.ticks ?? 10));
  const intervalMs = Math.max(20, Math.min(2000, data.intervalMs ?? 100));

  let sum = 0;
  for (let i = 1; i <= ticks; i++) {
    sum += i;
    stream({ tick: i, value: sum, total: ticks });
    if (i < ticks) await sleep(intervalMs);
  }

  return {
    status: 'success',
    result: { totalTicks: ticks, finalSum: sum },
  };
};
