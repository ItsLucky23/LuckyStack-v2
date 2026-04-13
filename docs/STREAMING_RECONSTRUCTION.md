# Streaming Reconstruction Guide

This document preserves the exact streaming demo implementation that was removed from `src/streaming`.

Use this when you want to recreate the previous playground route and handlers from documentation only.

---

## Removed Files (Reference)

The demo route previously contained these files:

- `src/streaming/page.tsx`
- `src/streaming/_api/textStream_v1.ts`
- `src/streaming/_api/textNoStream_v1.ts`
- `src/streaming/_sync/textServerProgress_server_v1.ts`
- `src/streaming/_sync/textClientProgress_server_v1.ts`
- `src/streaming/_sync/textClientProgress_client_v1.ts`

---

## Recreate File Tree

```text
src/
└── streaming/
    ├── page.tsx
    ├── _api/
    │   ├── textNoStream_v1.ts
    │   └── textStream_v1.ts
    └── _sync/
        ├── textClientProgress_client_v1.ts
        ├── textClientProgress_server_v1.ts
        └── textServerProgress_server_v1.ts
```

---

## 1) Page: `src/streaming/page.tsx`

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'home';

const formatEvent = (payload: unknown) => {
  return JSON.stringify(payload, null, 2);
};

export default function StreamingPage() {
  const translate = useTranslator();
  const { upsertSyncEventCallback, upsertSyncEventStreamCallback } = useSyncEvents();

  const [roomCode, setRoomCode] = useState<string>('streaming-demo-room');
  const [apiStreamEvents, setApiStreamEvents] = useState<string[]>([]);
  const [apiFinalResult, setApiFinalResult] = useState<string>('');
  const [noStreamResult, setNoStreamResult] = useState<string>('');

  const [syncServerEvents, setSyncServerEvents] = useState<string[]>([]);
  const [syncServerResult, setSyncServerResult] = useState<string>('');

  const [syncClientEvents, setSyncClientEvents] = useState<string[]>([]);
  const [syncClientResult, setSyncClientResult] = useState<string>('');

  const appendApiEvent = useCallback((line: string) => {
    setApiStreamEvents((prev) => [...prev, line]);
  }, []);

  const appendServerEvent = useCallback((line: string) => {
    setSyncServerEvents((prev) => [...prev, line]);
  }, []);

  const appendClientEvent = useCallback((line: string) => {
    setSyncClientEvents((prev) => [...prev, line]);
  }, []);

  useEffect(() => {
    const removeSyncResult = upsertSyncEventCallback({
      name: 'streaming/textClientProgress',
      version: 'v1',
      callback: ({ clientOutput, serverOutput }) => {
        setSyncClientResult(formatEvent({ clientOutput, serverOutput }));
      },
    });

    const removeSyncStream = upsertSyncEventStreamCallback({
      name: 'streaming/textClientProgress',
      version: 'v1',
      callback: ({ stream }) => {
        appendClientEvent(formatEvent(stream));
      },
    });

    return () => {
      removeSyncResult();
      removeSyncStream();
    };
  }, [appendClientEvent, upsertSyncEventCallback, upsertSyncEventStreamCallback]);

  const clearLogs = useCallback(() => {
    setApiStreamEvents([]);
    setApiFinalResult('');
    setNoStreamResult('');
    setSyncServerEvents([]);
    setSyncServerResult('');
    setSyncClientEvents([]);
    setSyncClientResult('');
  }, []);

  const ensureRoom = useCallback(() => {
    if (roomCode.trim().length > 0) {
      return true;
    }

    notify.error({ key: 'streaming.roomRequired' });
    return false;
  }, [roomCode]);

  const roomCodeLabel = useMemo(() => {
    return translate({ key: 'streaming.roomCode' });
  }, [translate]);

  const runApiStream = useCallback(async () => {
    setApiStreamEvents([]);
    setApiFinalResult('');

    const response = await apiRequest({
      name: 'streaming/textStream',
      version: 'v1',
      data: {
        text: 'LuckyStack can stream partial messages from API handlers',
        chunkSize: 8,
        delayMs: 120,
      },
      onStream: (event) => {
        appendApiEvent(formatEvent(event));
      },
    });

    setApiFinalResult(formatEvent(response));
  }, [appendApiEvent]);

  const runApiNoStream = useCallback(async () => {
    setNoStreamResult('');

    const response = await apiRequest({
      name: 'streaming/textNoStream',
      version: 'v1',
      data: {
        text: 'This route only sends a final response',
      },
    });

    setNoStreamResult(formatEvent(response));
  }, []);

  const runSyncServerStream = useCallback(async () => {
    if (!ensureRoom()) return;

    setSyncServerEvents([]);
    setSyncServerResult('');

    const response = await syncRequest({
      name: 'streaming/textServerProgress',
      version: 'v1',
      receiver: roomCode,
      data: {
        text: 'server stream event per processed word',
        delayMs: 130,
      },
      onStream: (event) => {
        appendServerEvent(formatEvent(event));
      },
    });

    setSyncServerResult(formatEvent(response));
  }, [appendServerEvent, ensureRoom, roomCode]);

  const runSyncClientStream = useCallback(async () => {
    if (!ensureRoom()) return;

    setSyncClientEvents([]);
    setSyncClientResult('');

    const response = await syncRequest({
      name: 'streaming/textClientProgress',
      version: 'v1',
      receiver: roomCode,
      data: {
        text: 'client stream event per delivered word',
        delayMs: 130,
      },
    });

    setSyncClientResult(formatEvent(response));
  }, [ensureRoom, roomCode]);

  const handleJoinRoom = useCallback(async () => {
    if (!ensureRoom()) return;

    const result = await joinRoom(roomCode);
    if (!result) {
      notify.error({ key: 'streaming.joinFailed' });
      return;
    }

    notify.success({ key: 'streaming.joinedRoom' });
  }, [ensureRoom, roomCode]);

  const handleLeaveRoom = useCallback(async () => {
    if (!ensureRoom()) return;

    const result = await leaveRoom(roomCode);
    if (!result) {
      notify.error({ key: 'streaming.leaveFailed' });
      return;
    }

    notify.success({ key: 'streaming.leftRoom' });
  }, [ensureRoom, roomCode]);

  return (
    <div className={`w-full h-full bg-background p-4 flex justify-center overflow-auto`}>
      <div className={`w-full max-w-6xl flex flex-col gap-4`}>
        <div className={`bg-container1 border-2 border-container1-border rounded-2xl p-4 flex flex-col gap-2`}>
          <div className={`text-2xl font-semibold text-title`}>{translate({ key: 'streaming.title' })}</div>
          <div className={`text-common`}>{translate({ key: 'streaming.subtitle' })}</div>
        </div>

        <div className={`bg-container1 border-2 border-container1-border rounded-2xl p-4 flex flex-col gap-3`}>
          <div className={`text-lg font-semibold text-title`}>{translate({ key: 'streaming.roomSection' })}</div>
          <div className={`flex flex-wrap gap-2 items-center`}>
            <div className={`text-common`}>{roomCodeLabel}</div>
            <input
              className={`bg-container2 border-2 border-container2-border rounded-lg px-3 py-2 text-common min-w-[240px]`}
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
            />
            <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void handleJoinRoom()}>
              {translate({ key: 'streaming.joinRoom' })}
            </button>
            <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void handleLeaveRoom()}>
              {translate({ key: 'streaming.leaveRoom' })}
            </button>
            <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={clearLogs}>
              {translate({ key: 'streaming.clearLogs' })}
            </button>
          </div>
        </div>

        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4`}>
          <div className={`bg-container1 border-2 border-container1-border rounded-2xl p-4 flex flex-col gap-3`}>
            <div className={`text-lg font-semibold text-title`}>{translate({ key: 'streaming.apiExamples' })}</div>
            <div className={`flex flex-wrap gap-2`}>
              <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void runApiStream()}>
                {translate({ key: 'streaming.runApiStream' })}
              </button>
              <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void runApiNoStream()}>
                {translate({ key: 'streaming.runApiNoStream' })}
              </button>
            </div>
            <div className={`text-sm text-muted`}>{translate({ key: 'streaming.apiNoStreamHint' })}</div>
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.apiStreamEvents' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-32`}>{apiStreamEvents.join('\n\n')}</pre>
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.apiFinalResponse' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{apiFinalResult}</pre>
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.noStreamFinalResponse' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{noStreamResult}</pre>
          </div>

          <div className={`bg-container1 border-2 border-container1-border rounded-2xl p-4 flex flex-col gap-3`}>
            <div className={`text-lg font-semibold text-title`}>{translate({ key: 'streaming.syncExamples' })}</div>
            <div className={`flex flex-wrap gap-2`}>
              <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void runSyncServerStream()}>
                {translate({ key: 'streaming.runSyncServerStream' })}
              </button>
              <button className={`bg-container2 hover:bg-container2-hover border-2 border-container2-border px-3 py-2 rounded-lg`} onClick={() => void runSyncClientStream()}>
                {translate({ key: 'streaming.runSyncClientStream' })}
              </button>
            </div>
            <div className={`text-sm text-muted`}>{translate({ key: 'streaming.syncHint' })}</div>

            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.syncServerEvents' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{syncServerEvents.join('\n\n')}</pre>
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.syncServerFinalResponse' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{syncServerResult}</pre>

            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.syncClientEvents' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{syncClientEvents.join('\n\n')}</pre>
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'streaming.syncClientFinalResponse' })}</div>
            <pre className={`bg-container2 border-2 border-container2-border rounded-xl p-3 text-xs text-common overflow-auto min-h-24`}>{syncClientResult}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 2) API: `src/streaming/_api/textStream_v1.ts`

```ts
import { AuthProps, SessionLayout } from '../../../config';
import { ApiResponse, ApiStreamEmitter, Functions } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: []
};

export interface ApiParams {
  data: {
    text?: string;
    chunkSize?: number;
    delayMs?: number;
  };
  user: SessionLayout;
  functions: Functions;
  stream: ApiStreamEmitter;
}

const splitByChunk = (text: string, chunkSize: number) => {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks;
};

export const main = async ({ data, functions, stream }: ApiParams): Promise<ApiResponse> => {
  const text = typeof data.text === 'string' && data.text.trim().length > 0
    ? data.text.trim()
    : 'LuckyStack streaming example response';

  const chunkSize = Number.isFinite(data.chunkSize)
    ? Math.max(1, Math.min(12, Math.floor(data.chunkSize ?? 4)))
    : 4;

  const delayMs = Number.isFinite(data.delayMs)
    ? Math.max(20, Math.min(3000, Math.floor(data.delayMs ?? 200)))
    : 200;

  const chunks = splitByChunk(text, chunkSize);
  let current = '';

  stream({
    event: 'started',
    progress: 0,
    done: false,
    message: 'streaming started',
    data: {
      totalChunks: chunks.length,
      chunkSize,
      delayMs,
    },
  });

  for (let index = 0; index < chunks.length; index += 1) {
    current += chunks[index];
    const progress = Math.round(((index + 1) / chunks.length) * 100);

    stream({
      event: 'chunk',
      progress,
      done: false,
      message: `chunk ${String(index + 1)}/${String(chunks.length)}`,
      data: {
        chunk: chunks[index],
        assembled: current,
      },
    });

    await functions.sleep.sleep(delayMs);
  }

  stream({
    event: 'finished',
    progress: 100,
    done: true,
    message: 'streaming finished',
    data: {
      text: current,
      chunks: chunks.length,
    },
  });

  return {
    status: 'success',
    result: {
      text: current,
      chunks: chunks.length,
    },
  };
};
```

---

## 3) API: `src/streaming/_api/textNoStream_v1.ts`

```ts
import { AuthProps, SessionLayout } from '../../../config';
import { ApiResponse, Functions } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: []
};

export interface ApiParams {
  data: {
    text?: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const text = typeof data.text === 'string' && data.text.trim().length > 0
    ? data.text.trim()
    : 'no stream payload emitted';

  return {
    status: 'success',
    result: {
      text,
      mode: 'final-only',
      timestamp: Date.now(),
    },
  };
};
```

---

## 4) Sync Server Stage: `src/streaming/_sync/textServerProgress_server_v1.ts`

```ts
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, SyncServerStreamEmitter } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
  additional: []
};

export interface SyncParams {
  clientInput: {
    text?: string;
    delayMs?: number;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
  stream: SyncServerStreamEmitter;
}

export const main = async ({ clientInput, functions, roomCode, stream }: SyncParams): Promise<SyncServerResponse> => {
  const text = typeof clientInput.text === 'string' && clientInput.text.trim().length > 0
    ? clientInput.text.trim()
    : 'server side sync stream';

  const delayMs = Number.isFinite(clientInput.delayMs)
    ? Math.max(20, Math.min(3000, Math.floor(clientInput.delayMs ?? 250)))
    : 250;

  stream({
    stage: 'server',
    event: 'started',
    progress: 0,
    done: false,
    message: 'server sync started',
    data: { text, roomCode },
  });

  const words = text.split(' ').filter((word) => word.length > 0);

  for (let index = 0; index < words.length; index += 1) {
    await functions.sleep.sleep(delayMs);

    stream({
      stage: 'server',
      event: 'word',
      progress: Math.round(((index + 1) / words.length) * 100),
      done: false,
      message: `server processed ${String(index + 1)}/${String(words.length)}`,
      data: {
        word: words[index],
        index: index + 1,
        total: words.length,
      },
    });
  }

  stream({
    stage: 'server',
    event: 'finished',
    progress: 100,
    done: true,
    message: 'server sync finished',
    data: {
      words: words.length,
      roomCode,
    },
  });

  return {
    status: 'success',
    processedWords: words.length,
    text,
    roomCode,
  };
};
```

---

## 5) Sync Server Stage: `src/streaming/_sync/textClientProgress_server_v1.ts`

```ts
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
  additional: []
};

export interface SyncParams {
  clientInput: {
    text?: string;
    delayMs?: number;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput, roomCode }: SyncParams): SyncServerResponse => {
  const text = typeof clientInput.text === 'string' && clientInput.text.trim().length > 0
    ? clientInput.text.trim()
    : 'client side sync stream';

  const delayMs = Number.isFinite(clientInput.delayMs)
    ? Math.max(20, Math.min(3000, Math.floor(clientInput.delayMs ?? 250)))
    : 250;

  return {
    status: 'success',
    text,
    delayMs,
    roomCode,
  };
};
```

---

## 6) Sync Client Stage: `src/streaming/_sync/textClientProgress_client_v1.ts`

```ts
import type { Functions, SyncClientInput, SyncClientOutput, SyncClientStreamEmitter, SyncServerOutput } from '../../../src/_sockets/apiTypes.generated';

type PagePath = 'streaming';
type SyncName = 'textClientProgress';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null;
  functions: Functions;
  roomCode: string;
  stream: SyncClientStreamEmitter;
}

export const main = async ({ roomCode, serverOutput, stream, functions }: SyncParams): Promise<SyncClientOutput<PagePath, SyncName>> => {
  const words = serverOutput.text.split(' ').filter((word) => word.length > 0);

  stream({
    stage: 'client',
    event: 'started',
    progress: 0,
    done: false,
    message: 'client sync started',
    data: {
      roomCode,
      totalWords: words.length,
    },
  });

  for (let index = 0; index < words.length; index += 1) {
    stream({
      stage: 'client',
      event: 'word',
      progress: Math.round(((index + 1) / words.length) * 100),
      done: false,
      message: `client delivered ${String(index + 1)}/${String(words.length)}`,
      data: {
        word: words[index],
        index: index + 1,
        total: words.length,
      },
    });

    await functions.sleep.sleep(serverOutput.delayMs);
  }

  stream({
    stage: 'client',
    event: 'finished',
    progress: 100,
    done: true,
    message: 'client sync finished',
    data: {
      roomCode,
      deliveredWords: words.length,
    },
  });

  return {
    status: 'success',
    deliveredWords: words.length,
    roomCode,
  };
};
```

---

## Locale Keys

The translation keys under `streaming.*` can remain in locale files. If they were removed, restore the same key set that `page.tsx` references.

---

## Regenerate Generated Artifacts

After recreating the files:

1. Run `npm run generateArtifacts`.
2. Restart `npm run server` if it is already running.
3. Keep `npm run client` running (or restart if needed).

This refreshes:

- `src/_sockets/apiTypes.generated.ts`
- `src/docs/apiDocs.generated.json`

---

## Validation Checklist

1. Open `/streaming` in browser tab A.
2. Open `/streaming` in browser tab B.
3. In both tabs, join the same room code.
4. Click API stream and confirm incremental events and final response.
5. Click API no-stream and confirm only final response.
6. Click sync server stream and confirm requester receives server progress.
7. Click sync client stream and confirm both tabs receive receiver-side stream events and final sync payload.

If receiver-side events do not appear on tab B, confirm both tabs joined the exact same room string (no leading/trailing spaces).
