/* eslint-disable react/jsx-no-literals, luckystack/no-raw-try-catch, luckystack/no-raw-fetch-in-src --
   In-repo dev playground for exercising the framework's own core features. It
   uses raw fetch + try/catch deliberately to demonstrate fallback patterns and
   exercise transports side-by-side. Do NOT propagate these disables to consumer
   feature code. */
import {
  faBolt,
  faBomb,
  faBroadcastTower,
  faChevronDown,
  faChevronUp,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faDoorOpen,
  faEnvelope,
  faHeartPulse,
  faKey,
  faLink,
  faList,
  faPaperPlane,
  faPlus,
  faPlugCircleXmark,
  faRotateRight,
  faShieldHalved,
  faSignOutAlt,
  faStopwatch,
  faTrash,
  faTriangleExclamation,
  faUser,
  faWaveSquare,
  faWifi,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { toast } from 'sonner';
import { useEffect, useRef, useState } from 'react';

import {
  getCsrfToken,
  clearCsrfToken,
  httpFetch,
  socket,
  getApiQueueSize,
  getSyncQueueSize,
  useSession,
} from '@luckystack/core/client';

import Avatar from 'src/_components/Avatar';
import Dropdown, { type DropdownItem } from 'src/_components/Dropdown';
import MultiSelectDropdown from 'src/_components/MultiSelectDropdown';
import { menuHandler } from 'src/_functions/menuHandler';
import { apiRequest } from 'src/_sockets/apiRequest';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { providers as registeredProviderIds, backendUrl, sessionBasedToken } from 'config';

//? Filter out the credentials login provider — it isn't an OAuth flow (no
//? external redirect; it's a username/password form on /login). Showing it
//? in the OAuth provider list and POSTing to /auth/api/credentials would
//? 404 or be confusing.
const oauthProviderIds = registeredProviderIds.filter((id) => id !== 'credentials');

export const template = 'dashboard';

//? Per-page route guard. Replaces the `/playground` case in
//? `src/_functions/middlewareHandler.ts`: any logged-out visitor is bounced
//? to `/login`; logged-in users pass through. Defined as an explicit
//? `PageMiddleware` so the framework's auto-discovery wires it up.
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

//? In-repo dev playground for visually testing the framework's own core
//? features (API/sync/auth/email/health/offline/presence + UI primitives).
//? Kept as a developer tool — it is NEVER shipped to consumers (not in any
//? package tarball nor the create-luckystack-app template).

const COUNTRIES: DropdownItem[] = [
  { id: 'nl', value: 'nl', placeholder: 'Netherlands' },
  { id: 'be', value: 'be', placeholder: 'Belgium' },
  { id: 'de', value: 'de', placeholder: 'Germany' },
  { id: 'fr', value: 'fr', placeholder: 'France' },
  { id: 'es', value: 'es', placeholder: 'Spain' },
  { id: 'it', value: 'it', placeholder: 'Italy' },
  { id: 'pt', value: 'pt', placeholder: 'Portugal' },
  { id: 'pl', value: 'pl', placeholder: 'Poland' },
  { id: 'cz', value: 'cz', placeholder: 'Czech Republic' },
  { id: 'at', value: 'at', placeholder: 'Austria' },
  { id: 'ch', value: 'ch', placeholder: 'Switzerland' },
  { id: 'se', value: 'se', placeholder: 'Sweden' },
  { id: 'no', value: 'no', placeholder: 'Norway' },
  { id: 'dk', value: 'dk', placeholder: 'Denmark' },
  { id: 'fi', value: 'fi', placeholder: 'Finland' },
  { id: 'ie', value: 'ie', placeholder: 'Ireland' },
  { id: 'uk', value: 'uk', placeholder: 'United Kingdom' },
  { id: 'gr', value: 'gr', placeholder: 'Greece', disabled: true },
];

const ROLES: DropdownItem[] = [
  { id: 'owner', value: 'owner', placeholder: 'Owner' },
  { id: 'admin', value: 'admin', placeholder: 'Admin' },
  { id: 'editor', value: 'editor', placeholder: 'Editor' },
  { id: 'viewer', value: 'viewer', placeholder: 'Viewer' },
  { id: 'banned', value: 'banned', placeholder: 'Banned (disabled)', disabled: true },
];

const COLOR_TOKENS = [
  'background',
  'container1',
  'container1-hover',
  'container1-border',
  'container2',
  'container2-hover',
  'container2-border',
  'title',
  'common',
  'primary',
  'primary-hover',
  'primary-border',
  'correct',
  'warning',
  'wrong',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 bg-container1 border border-container1-border rounded-xl p-5">
      <h2 className="text-base font-semibold text-title">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <div className="text-xs text-common">{label}</div>}
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

//? Showcase layout primitives. A page is a stack of CardGroups; each group is an
//? icon + intro + a responsive grid of DemoCards. A DemoCard pairs ONE action
//? with its own controls + a plain-language "what it does" + "what you'll see",
//? so nothing is a mystery button anymore.
function CardGroup({
  icon,
  title,
  intro,
  children,
  cols = 2,
}: {
  icon: IconDefinition;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-title flex items-center gap-2">
          <FontAwesomeIcon icon={icon} className="text-primary" /> {title}
        </h2>
        {intro && <p className="text-sm text-common max-w-3xl leading-relaxed">{intro}</p>}
      </div>
      <div className={`grid gap-4 items-start ${cols === 2 ? 'lg:grid-cols-2' : ''}`}>{children}</div>
    </section>
  );
}

const cardTone: Record<'default' | 'api' | 'sync' | 'danger', string> = {
  default: 'border-container1-border',
  api: 'border-primary/30',
  sync: 'border-correct/30',
  danger: 'border-wrong/30',
};

function DemoCard({
  title,
  what,
  expect,
  tone = 'default',
  full,
  children,
}: {
  title: string;
  what?: React.ReactNode;
  expect?: React.ReactNode;
  tone?: 'default' | 'api' | 'sync' | 'danger';
  full?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-3 bg-container1 border rounded-xl p-4 ${cardTone[tone]} ${full ? 'lg:col-span-2' : ''}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-title">{title}</h3>
        {what && <p className="text-xs text-common leading-relaxed">{what}</p>}
        {expect && (
          <p className="text-xs text-muted leading-relaxed">
            <span className="text-correct font-semibold">→ </span>{expect}
          </p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">{children}</div>}
    </div>
  );
}

const btnVariant: Record<'primary' | 'correct' | 'ghost' | 'danger' | 'warning', string> = {
  primary: 'bg-primary hover:bg-primary-hover text-white',
  correct: 'bg-correct hover:bg-correct-hover text-white',
  ghost: 'bg-container2 border border-container2-border hover:bg-container2-hover text-title',
  danger: 'bg-wrong hover:bg-wrong-hover text-white',
  warning: 'bg-warning hover:bg-warning-hover text-white',
};

function Btn({
  onClick,
  icon,
  children,
  variant = 'primary',
  disabled,
  title,
}: {
  onClick?: () => void;
  icon?: IconDefinition;
  children: React.ReactNode;
  variant?: keyof typeof btnVariant;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-9 px-3 rounded-md text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${btnVariant[variant]}`}
    >
      {icon && <FontAwesomeIcon icon={icon} />} {children}
    </button>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => { onChange(event.target.value); }}
      className={`h-9 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors ${mono ? 'font-mono' : ''} ${className}`}
    />
  );
}

interface LogEntry {
  id: number;
  ts: string;
  channel:
    | 'api'
    | 'api-stream'
    | 'sync'
    | 'sync-stream'
    | 'room'
    | 'system'
    | 'auth'
    | 'settings'
    | 'health'
    | 'offline'
    | 'hook';
  message: string;
  payload?: unknown;
}

let logCounter = 0;
const nextLogId = () => {
  logCounter += 1;
  return logCounter;
};

const formatTime = (date: Date): string => {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
};

const formatPayload = (payload: unknown): string => {
  if (payload === undefined) return '';
  try {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    //? JSON.stringify can throw on circular refs / BigInt. Fallback that
    //? avoids `[object Object]` from `String(payload)` on a plain object.
    return Object.prototype.toString.call(payload);
  }
};

const channelLabel: Record<LogEntry['channel'], { label: string; tone: string }> = {
  'api': { label: 'API', tone: 'bg-primary/15 text-primary' },
  'api-stream': { label: 'API stream', tone: 'bg-primary/25 text-primary' },
  'sync': { label: 'sync', tone: 'bg-correct/15 text-correct' },
  'sync-stream': { label: 'sync stream', tone: 'bg-correct/25 text-correct' },
  'room': { label: 'room', tone: 'bg-warning/15 text-warning' },
  'system': { label: 'system', tone: 'bg-container2 text-common' },
  'auth': { label: 'auth', tone: 'bg-primary/15 text-primary' },
  'settings': { label: 'settings', tone: 'bg-container2 text-common' },
  'health': { label: 'health', tone: 'bg-correct/15 text-correct' },
  'offline': { label: 'offline', tone: 'bg-wrong/15 text-wrong' },
  'hook': { label: 'hook', tone: 'bg-wrong/15 text-wrong' },
};

const handleConfirmBasic = async () => {
  const confirmed = await menuHandler.confirm({
    title: 'Delete project?',
    content: 'This will remove the project and all of its files. This action cannot be undone.',
  });
  toast.info(`Confirm result: ${String(confirmed)}`);
};

const handleConfirmTyped = async () => {
  const confirmed = await menuHandler.confirm({
    title: 'Type DELETE to continue',
    content: 'This is a destructive action gated by a typed-confirm input.',
    input: 'DELETE',
  });
  toast.info(`Typed-confirm result: ${String(confirmed)}`);
};

export default function Playground() {
  //? React 18+ does not propagate errors thrown inside event handlers to
  //? error boundaries (router or React's). The button sets state, then the
  //? next render throws — which IS caught by React Router's `errorElement`
  //? (ErrorPage). This is the canonical pattern for "preview the error
  //? page" buttons.
  const [shouldThrowForPreview, setShouldThrowForPreview] = useState(false);
  if (shouldThrowForPreview) {
    throw new Error('Test error from the Playground page — confirms ErrorPage rendering.');
  }

  // ───────────────────────── Test bench: API + sync + rooms ─────────────────
  //? Multi-browser test surface. Open this page in two windows, type the
  //? same room code in both and click "Join", then fire the sync buttons
  //? to confirm cross-browser fan-out + streaming.
  const [roomCode, setRoomCode] = useState<string>('playground-room');
  //? `session.roomCodes` is the authoritative, server-persisted room list (it
  //? survives a page reload). We mirror it into local state and seed/re-sync from
  //? the session whenever it changes (login, reload, server push). Join/Leave then
  //? update it optimistically from their response for instant feedback.
  const { session } = useSession();
  const [joinedRooms, setJoinedRooms] = useState<string[]>([]);
  const [echoMessage, setEchoMessage] = useState<string>('hello world');
  const [streamText, setStreamText] = useState<string>(
    'The quick brown fox jumps over the lazy dog. This sentence is being streamed token by token to demonstrate live broadcast streaming across every browser joined to the room.',
  );
  const [showApiStreams, setShowApiStreams] = useState(true);
  const [showSyncStreams, setShowSyncStreams] = useState(true);
  const [useThrottle, setUseThrottle] = useState(true);
  //? Default 20ms = faster than the broadcast throttle's 50ms flush window,
  //? so batching is visible when the throttle is enabled. Real LLM streams
  //? sit in this range too.
  const [streamIntervalMs, setStreamIntervalMs] = useState<number>(20);
  const [streamToTargets, setStreamToTargets] = useState<string>('');
  const [mySocketId, setMySocketId] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState<boolean>(true);

  //? Auxiliary state for the feature sections below the test bench.
  const [csrfTokenDisplay, setCsrfTokenDisplay] = useState<string | null>(null);
  const [forgotEmail, setForgotEmail] = useState<string>('');
  const [offlineSimulated, setOfflineSimulated] = useState<boolean>(false);
  const [apiQueueSize, setApiQueueSize] = useState<number>(0);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);

  const showApiStreamsRef = useRef(showApiStreams);
  showApiStreamsRef.current = showApiStreams;
  const showSyncStreamsRef = useRef(showSyncStreams);
  showSyncStreamsRef.current = showSyncStreams;
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  //? Live queue-size poll while the test bench is open. Cheap — single
  //? interval reading two getters. Stops when the page unmounts.
  useEffect(() => {
    const handle = globalThis.setInterval(() => {
      setApiQueueSize(getApiQueueSize());
      setSyncQueueSize(getSyncQueueSize());
    }, 500);
    return () => { globalThis.clearInterval(handle); };
  }, []);

  //? Seed + re-sync the joined-room badge from the persisted session. This is
  //? what makes the badge correct after a reload (the previous local-only state
  //? reset to empty on refresh even though the server session still had the room).
  useEffect(() => {
    setJoinedRooms(session?.roomCodes ?? []);
  }, [session?.roomCodes]);

  const log = (
    channel: LogEntry['channel'],
    message: string,
    payload?: unknown,
  ): void => {
    setLogs((prev) => {
      const next: LogEntry[] = [
        ...prev,
        { id: nextLogId(), ts: formatTime(new Date()), channel, message, payload },
      ];
      //? Cap memory — playground sessions tend to spam tokens.
      return next.length > 250 ? next.slice(- 250) : next;
    });
  };

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);

  //? Subscribe to the playground sync routes. The non-stream callback fires
  //? once per sync (final serverOutput); the stream callback fires per chunk.
  //? Both are wired here so the log panel reflects the full lifecycle from
  //? every browser tab joined to the room.
  const { upsertSyncEventCallback, upsertSyncEventStreamCallback } = useSyncEvents();
  useEffect(() => {
    const teardownEcho = upsertSyncEventCallback({
      name: 'playground/echo',
      version: 'v1',
      callback: ({ serverOutput }) => {
        log('sync', `playground/echo received`, serverOutput);
      },
    });
    return () => { teardownEcho(); };
  }, [upsertSyncEventCallback]);

  useEffect(() => {
    const teardownBroadcast = upsertSyncEventCallback({
      name: 'playground/streamBroadcast',
      version: 'v1',
      callback: ({ serverOutput }) => {
        log('sync', `streamBroadcast complete`, serverOutput);
      },
    });
    return () => { teardownBroadcast(); };
  }, [upsertSyncEventCallback]);

  useEffect(() => {
    const teardownProgress = upsertSyncEventCallback({
      name: 'playground/streamProgress',
      version: 'v1',
      callback: ({ serverOutput }) => {
        log('sync', `streamProgress complete`, serverOutput);
      },
    });
    return () => { teardownProgress(); };
  }, [upsertSyncEventCallback]);

  //? Stream callback for the broadcast route: fires for every token received
  //? from `broadcastStream` on the server. This is what makes the live
  //? cross-browser feed visible.
  useEffect(() => {
    const teardown = upsertSyncEventStreamCallback({
      name: 'playground/streamBroadcast',
      version: 'v1',
      callback: ({ stream }) => {
        if (!showSyncStreamsRef.current) return;
        const chunk = (stream as { chunk?: string } | undefined)?.chunk;
        if (typeof chunk === 'string' && chunk.length > 0) {
          log('sync-stream', `broadcast chunk: "${chunk}"`);
        }
      },
    });
    return () => { teardown(); };
  }, [upsertSyncEventStreamCallback]);

  //? streamTo callback: only tabs whose token / socket id was included in
  //? the request's `targetTokens` receive these chunks. Tabs joined to the
  //? same room but NOT in the target list see nothing — that's the whole
  //? point of `streamTo` over `broadcastStream`.
  useEffect(() => {
    const teardown = upsertSyncEventStreamCallback({
      name: 'playground/streamToToken',
      version: 'v1',
      callback: ({ stream }) => {
        if (!showSyncStreamsRef.current) return;
        const chunk = (stream as { chunk?: string } | undefined)?.chunk;
        if (typeof chunk === 'string' && chunk.length > 0) {
          log('sync-stream', `streamTo chunk: "${chunk}"`);
        }
      },
    });
    return () => { teardown(); };
  }, [upsertSyncEventStreamCallback]);

  //? Stash this tab's socket id so the streamTo demo can show "Copy socket id"
  //? — paste into another tab's target field to direct chunks at this tab.
  useEffect(() => {
    const handle = globalThis.setInterval(() => {
      const id = socket?.id ?? '';
      setMySocketId((prev) => (prev === id ? prev : id));
    }, 300);
    return () => { globalThis.clearInterval(handle); };
  }, []);

  const handleJoinRoom = async () => {
    const trimmed = roomCode.trim();
    if (!trimmed) {
      toast.error('Enter a room code first.');
      return;
    }
    setBusy('join');
    const result = await joinRoom(trimmed);
    setBusy(null);
    if (result?.success) {
      setJoinedRooms(result.rooms);
      log('room', `joined "${trimmed}"`, { rooms: result.rooms });
    } else {
      log('room', `joinRoom("${trimmed}") failed`);
      toast.error('Join failed — check the server log + your auth.');
    }
  };

  const handleLeaveRoom = async () => {
    const trimmed = roomCode.trim();
    if (!trimmed) return;
    setBusy('leave');
    const result = await leaveRoom(trimmed);
    setBusy(null);
    if (result?.success) {
      setJoinedRooms(result.rooms);
      log('room', `left "${trimmed}"`, { rooms: result.rooms });
    } else {
      log('room', `leaveRoom("${trimmed}") failed`);
    }
  };

  const handleApiEcho = async () => {
    setBusy('apiEcho');
    log('api', `→ playground/echo "${echoMessage}"`);
    const response = await apiRequest({
      name: 'playground/echo',
      version: 'v1',
      data: { message: echoMessage },
    });
    setBusy(null);
    log('api', `← playground/echo`, response.result);
  };

  const handleApiStream = async () => {
    setBusy('apiStream');
    log('api', `→ playground/streamCounter (10 ticks @ ${String(streamIntervalMs)}ms)`);
    const response = await apiRequest({
      name: 'playground/streamCounter',
      version: 'v1',
      data: { ticks: 10, intervalMs: streamIntervalMs },
      onStream: (chunk) => {
        if (showApiStreamsRef.current) {
          log('api-stream', `tick ${String(chunk.tick)}/${String(chunk.total)} = ${String(chunk.value)}`);
        }
      },
    });
    setBusy(null);
    log('api', `← streamCounter complete`, response.result);
  };

  //? Sync requests need a room receiver. We don't pop a toast when the user
  //? hasn't joined the typed room — the "Joined" badge next to the input is
  //? the persistent signal (green when the current room is joined, warning
  //? when not). The toast was firing as a false positive whenever the input
  //? changed after join, or during the brief race between server-emit and
  //? React state update.
  const requireRoom = (): string | null => {
    const trimmed = roomCode.trim();
    if (!trimmed) {
      toast.error('Enter + join a room first.');
      return null;
    }
    return trimmed;
  };

  const handleSyncEcho = async () => {
    const room = requireRoom();
    if (!room) return;
    setBusy('syncEcho');
    log('sync', `→ playground/echo (room: ${room}) "${echoMessage}"`);
    const response = await syncRequest({
      name: 'playground/echo',
      version: 'v1',
      data: { message: echoMessage },
      receiver: room,
    });
    setBusy(null);
    if (response.status === 'error') {
      log('sync', `syncRequest error`, response);
    }
  };

  const handleSyncBroadcast = async () => {
    const room = requireRoom();
    if (!room) return;
    setBusy('syncBroadcast');
    log('sync', `→ playground/streamBroadcast (room: ${room}, throttle=${String(useThrottle)})`);
    const response = await syncRequest({
      name: 'playground/streamBroadcast',
      version: 'v1',
      data: { text: streamText, intervalMs: streamIntervalMs, throttle: useThrottle },
      receiver: room,
    });
    setBusy(null);
    if (response.status === 'error') {
      log('sync', `syncRequest error`, response);
    }
  };

  const handleSyncStreamTo = async () => {
    const room = requireRoom();
    if (!room) return;
    const targets = streamToTargets.trim();
    if (!targets) {
      toast.error('Paste at least one target token / socket id first.');
      return;
    }
    setBusy('syncStreamTo');
    log('sync', `→ playground/streamToToken (targets: ${targets})`);
    const response = await syncRequest({
      name: 'playground/streamToToken',
      version: 'v1',
      data: { targetTokens: targets, text: streamText, intervalMs: streamIntervalMs },
      receiver: room,
    });
    setBusy(null);
    if (response.status === 'success') {
      log('sync', `← streamToToken complete`, response.result);
    } else {
      log('sync', `← streamToToken error`, response);
    }
  };

  const handleCopySocketId = async () => {
    if (!mySocketId) {
      toast.error('No socket id yet — make sure the socket is connected.');
      return;
    }
    try {
      await navigator.clipboard.writeText(mySocketId);
      toast.success(`Copied: ${mySocketId}`);
    } catch {
      toast.info(`Socket id: ${mySocketId} (clipboard failed — copy from log)`);
      log('system', `socket.id = ${mySocketId}`);
    }
  };

  const handleSyncProgress = async () => {
    const room = requireRoom();
    if (!room) return;
    setBusy('syncProgress');
    log('sync', `→ playground/streamProgress (room: ${room}, originator-only)`);
    const response = await syncRequest({
      name: 'playground/streamProgress',
      version: 'v1',
      data: { steps: 8, intervalMs: 200 },
      receiver: room,
      onStream: (chunk) => {
        if (showSyncStreamsRef.current) {
          log('sync-stream', `progress ${String(chunk.progress)}% (${chunk.phase})`);
        }
      },
    });
    setBusy(null);
    if (response.status === 'error') {
      log('sync', `syncRequest error`, response);
    }
  };

  const handleStackedMenu = () => {
    void menuHandler.open(
      <div className="p-6 bg-container1 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-title">First menu</h2>
        <p className="text-sm text-common">
          Open another menu on top to test stacking + slide animation.
        </p>
        <button
          type="button"
          className="self-start h-9 px-4 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer"
          onClick={() => {
            void menuHandler.open(
              <div className="p-6 bg-container1 flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-title">Second menu</h2>
                <p className="text-sm text-common">
                  Press Escape or click outside to close.
                </p>
                <button
                  type="button"
                  className="self-start h-9 px-4 rounded-md bg-container2 hover:bg-container2-hover border border-container2-border text-title text-sm font-medium transition-colors cursor-pointer"
                  onClick={() => { menuHandler.close(); }}
                >
                  Close this one
                </button>
              </div>,
              { dimBackground: true, size: 'md' },
            );
          }}
        >
          Open second menu
        </button>
      </div>,
      { dimBackground: true, size: 'md' },
    );
  };

  const handleErrorPagePreview = () => {
    setShouldThrowForPreview(true);
  };

  // ───────────────────────── Auth & CSRF ─────────────────────────
  const handleFetchCsrf = async () => {
    setBusy('csrf');
    const token = await getCsrfToken();
    setBusy(null);
    setCsrfTokenDisplay(token);
    if (token) {
      log('auth', `CSRF token fetched`, { preview: `${token.slice(0, 12)}…` });
    } else {
      log('auth', `CSRF skipped (token mode or no session)`);
    }
  };

  const handleClearCsrf = () => {
    clearCsrfToken();
    setCsrfTokenDisplay(null);
    log('auth', `CSRF cache cleared (next fetch re-fetches from /auth/csrf)`);
  };

  const handleSendForgotPassword = async () => {
    const email = forgotEmail.trim();
    if (!email) { toast.error('Enter an email first.'); return; }
    setBusy('forgot');
    log('auth', `→ reset-password/sendReset "${email}"`);
    const response = await apiRequest({
      name: 'reset-password/sendReset',
      version: 'v1',
      data: { email },
    });
    setBusy(null);
    if (response.status === 'success') {
      log('auth', `← reset-password/sendReset (always-success for anti-enumeration)`);
    } else {
      log('auth', `← reset-password/sendReset error`, response);
    }
  };

  //? Diagnostic counterpart to handleSendForgotPassword. The real
  //? sendReset endpoint is anti-enumeration so it never tells you WHY
  //? an email didn't arrive. This calls a debug endpoint that surfaces
  //? the actual sendEmail() result + reason.
  const handleSendTestEmail = async () => {
    const email = forgotEmail.trim();
    if (!email) { toast.error('Enter an email first.'); return; }
    setBusy('testEmail');
    log('auth', `→ playground/testEmail "${email}" (diagnostic; bypasses anti-enumeration)`);
    const response = await apiRequest({
      name: 'playground/testEmail',
      version: 'v1',
      data: { email },
    });
    setBusy(null);
    if (response.status !== 'success') {
      log('auth', `← playground/testEmail API error`, response);
      toast.error(`Test email request failed: ${response.errorCode}`);
      return;
    }
    const result = response.result;
    log('auth', `← playground/testEmail result`, result);
    if (result.ok) {
      toast.success(`Sent. Provider message id: ${result.id ?? '(none)'} — check your inbox.`);
    } else {
      toast.error(
        `Email NOT sent — reason: ${result.reason ?? 'unknown'}. ` +
        `Check the server terminal for [email:<adapter>] FAILED with full context.`,
      );
    }
  };

  const handleOauthLaunch = (providerId: string) => {
    log('auth', `Redirecting to /auth/api/${providerId}`);
    globalThis.location.href = `${backendUrl}/auth/api/${providerId}`;
  };

  // ───────────────────────── Settings flows ─────────────────────────
  const handleListSessions = async () => {
    setBusy('listSessions');
    log('settings', `→ settings/listSessions`);
    const response = await apiRequest({
      name: 'settings/listSessions',
      version: 'v1',
      data: {},
    });
    setBusy(null);
    if (response.status === 'success') {
      log('settings', `← ${String(response.result.sessions.length)} session(s)`, response.result);
    } else {
      log('settings', `← listSessions error`, response);
    }
  };

  const handleSignOutEverywhere = async () => {
    const confirmed = await menuHandler.confirm({
      title: 'Sign out everywhere?',
      content: 'This revokes every session including the current one. You will be logged out.',
    });
    if (!confirmed) return;
    setBusy('signOut');
    log('settings', `→ settings/signOutEverywhere`);
    const response = await apiRequest({
      name: 'settings/signOutEverywhere',
      version: 'v1',
      data: {},
    });
    setBusy(null);
    log('settings', `← signOutEverywhere`, response);
  };

  const handleUpdatePreferences = async (enable: boolean) => {
    setBusy('prefs');
    log('settings', `→ settings/updatePreferences — ${enable ? 'enabling' : 'disabling'} sign-in + password-change email notifications`);
    const response = await apiRequest({
      name: 'settings/updatePreferences',
      version: 'v1',
      data: { preferences: { notifyOnNewSignIn: enable, notifyOnPasswordChange: enable } },
    });
    setBusy(null);
    log('settings', `← updatePreferences`, response);
    if (response.status === 'success') {
      toast.success(
        enable
          ? 'Email notifications ENABLED. Next sign-in or password change will trigger an email.'
          : 'Email notifications DISABLED. Sign-in / password-change emails will not be sent.',
      );
    } else {
      toast.error(`updatePreferences failed: ${response.errorCode}`);
    }
  };

  // ───────────────────────── Hooks demo ─────────────────────────
  const handleTriggerApiError = async () => {
    setBusy('throwError');
    log('hook', `→ playground/throwError (mode=throw → apiError hook fires server-side)`);
    const response = await apiRequest({
      name: 'playground/throwError',
      version: 'v1',
      data: { mode: 'throw' },
    });
    setBusy(null);
    log('hook', `← response (normalized)`, response);
  };

  const handleTriggerSyncError = async () => {
    const room = requireRoom();
    if (!room) return;
    setBusy('throwSync');
    log('hook', `→ playground/throwSync (room: ${room}) → syncError hook fires server-side`);
    const response = await syncRequest({
      name: 'playground/throwSync',
      version: 'v1',
      data: { reason: 'demo trigger from playground' },
      receiver: room,
    });
    setBusy(null);
    log('hook', `← sync response (normalized)`, response);
  };

  const handleRateLimitSpam = async () => {
    setBusy('spam');
    log('hook', `→ playground/spam ×10 (rateLimit: 3 ⇒ first 3 succeed, rest get rateLimit.exceeded)`);
    const responses = await Promise.all(
      Array.from({ length: 10 }).map(() => apiRequest({
        name: 'playground/spam',
        version: 'v1',
        data: {},
      })),
    );
    setBusy(null);
    //? Widen the response type: the generated `playground/spam` output only
    //? declares the success branch, but at runtime rate-limited calls return
    //? `{status: 'error', errorCode: 'rateLimit.exceeded'}` from the framework
    //? wrapper — that's exactly what we want to count here.
    const widened: { status: string }[] = responses;
    const successes = widened.filter((r) => r.status === 'success').length;
    const blocked = widened.length - successes;
    log('hook', `← ${String(successes)} ok / ${String(blocked)} rate-limited`, widened.map((r) => r.status));
  };

  // ───────────────────────── Health endpoints ─────────────────────────
  const handleHealthFetch = async (path: '/livez' | '/readyz' | '/_health') => {
    setBusy(`health:${path}`);
    log('health', `→ GET ${path}`);
    const [error, body] = await (async (): Promise<[Error | null, { status: number; body: unknown }]> => {
      try {
        const res = await fetch(`${backendUrl}${path}`, { credentials: 'include' });
        const text = await res.text();
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        return [null, { status: res.status, body: parsed }];
      } catch (error_) {
        return [error_ as Error, { status: 0, body: null }];
      }
    })();
    setBusy(null);
    if (error) {
      log('health', `← ${path} fetch error: ${error.message}`);
      toast.error(`${path} → ${error.message}`);
      return;
    }
    log('health', `← ${path} ${String(body.status)}`, body.body);

    if (body.status === 200) {
      toast.success(`${path} → 200 OK`);
      return;
    }

    //? Surface WHICH subsystem failed so the user doesn't have to scroll up
    //? to the log panel. /readyz returns `{checks:{bootUuid,redis,prisma}}`,
    //? /_health returns `{status, bootUuid, ...}` — extract whichever fields
    //? exist and render them as a one-line summary.
    const parsedBody = body.body as Record<string, unknown> | null;
    let detail = '';
    if (parsedBody && typeof parsedBody === 'object') {
      const checks = parsedBody.checks as Record<string, unknown> | undefined;
      if (checks && typeof checks === 'object') {
        const failing = Object.entries(checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => name);
        if (failing.length > 0) {
          detail = ` — failing: ${failing.join(', ')}`;
        }
      } else if (path === '/_health' && parsedBody.bootUuid === null) {
        detail = ' — bootUuid not written yet (server still booting?)';
      }
    }
    toast.error(`${path} → ${String(body.status)}${detail}`);
  };

  // ───────────────────────── Offline queue ─────────────────────────
  const handleToggleOffline = () => {
    if (offlineSimulated) {
      socket?.connect();
      setOfflineSimulated(false);
      log('offline', `socket.connect() — queued items will flush as the socket reconnects`);
    } else {
      socket?.disconnect();
      setOfflineSimulated(true);
      log('offline', `socket.disconnect() — subsequent api/sync calls will enqueue (offline queue)`);
    }
  };

  const handleEnqueueOffline = () => {
    setBusy('queueFill');
    log('offline', `→ firing 5 syncRequests while ${offlineSimulated ? 'OFFLINE' : 'online'} — watch the queue`);
    const room = requireRoom() ?? 'playground-room';
    //? Don't await — we want to see the queue fill, not block on each promise.
    for (let i = 0; i < 5; i++) {
      void syncRequest({
        name: 'playground/echo',
        version: 'v1',
        data: { message: `queued-${String(i)}` },
        receiver: room,
      });
    }
    setBusy(null);
  };

  // ───────────────────────── Test reset ─────────────────────────
  const handleTestReset = async () => {
    const confirmed = await menuHandler.confirm({
      title: 'Wipe dev/test state?',
      content: 'POSTs to /_test/reset which clears rate-limit counters, sessions, and active-user Redis keys. Safe in dev because the route is gated by NODE_ENV + TEST_RESET_TOKEN — production deploys will 403.',
    });
    if (!confirmed) return;
    setBusy('testReset');
    log('health', `→ POST /_test/reset`);
    const res = await httpFetch(`${backendUrl}/_test/reset`, { method: 'POST' });
    const body: unknown = await res.json().catch(() => ({ raw: 'non-JSON' }));
    setBusy(null);
    log('health', `← ${String(res.status)}`, body);
    if (res.status === 200) {
      toast.success('Dev state wiped — rate limits, sessions, active users.');
    } else {
      toast.warning(`/_test/reset → ${String(res.status)} (gated; set NODE_ENV + TEST_RESET_TOKEN to enable)`);
    }
  };

  const lastLog = logs.length > 0 ? logs.at(-1) : null;
  const drawerHeightClass = logExpanded ? 'h-80' : 'h-10';
  const contentPaddingClass = logExpanded ? 'pb-[336px]' : 'pb-16';

  return (
    <div className={`w-full h-full overflow-y-auto bg-background ${contentPaddingClass}`}>
      <div className="max-w-5xl mx-auto p-6 flex flex-col gap-5">

        <header className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-title">Playground</h1>
            <p className="text-sm text-common max-w-3xl leading-relaxed">
              A live showcase of every LuckyStack feature against a real backend. Each card pairs one action
              with <strong>what it does</strong> and <strong>what you&apos;ll see</strong>, next to its own controls — fire it
              and watch the result land in the log drawer pinned at the bottom of the screen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-md bg-container2 text-common font-mono">
              backend: {backendUrl.replace(/^https?:\/\//, '')}
            </span>
            <span className={`px-2 py-1 rounded-md font-mono ${sessionBasedToken ? 'bg-warning/15 text-warning' : 'bg-correct/15 text-correct'}`}>
              auth: {sessionBasedToken ? 'sessionStorage token' : 'HttpOnly cookie + CSRF'}
            </span>
            <span className="px-2 py-1 rounded-md bg-container2 text-muted">
              dev tool — <code className="font-mono">src/playground/</code> (not shipped to consumers)
            </span>
          </div>
        </header>

        <CardGroup
          icon={faBolt}
          title="Real-time — API vs Sync"
          intro={<>
            <strong>API</strong> is a direct request → reply (the answer comes back to <em>you</em>).
            <strong> Sync</strong> runs once on the server and fans out to <em>every</em> tab in a room.
            To see the difference, open this page in two tabs and join the same room in both.
          </>}
          cols={1}
        >
          <DemoCard
            full
            title="Setup — join a room"
            what="Every Sync action below broadcasts to a room. Join the same room in two tabs (or two browsers) to watch messages cross between them."
            expect="The badge turns green when this tab is in the typed room."
          >
            <TextInput value={roomCode} onChange={setRoomCode} placeholder="room-code" className="w-56" />
            <Btn icon={faDoorOpen} disabled={busy === 'join'} onClick={() => void handleJoinRoom()}>Join</Btn>
            <Btn variant="ghost" disabled={busy === 'leave'} onClick={() => void handleLeaveRoom()}>Leave</Btn>
            {(() => {
              const trimmedRoom = roomCode.trim();
              const currentJoined = trimmedRoom.length > 0 && joinedRooms.includes(trimmedRoom);
              return (
                <span
                  className={`self-center px-2 py-1 rounded-md font-mono text-xs ${
                    currentJoined
                      ? 'bg-correct/15 text-correct'
                      : (joinedRooms.length > 0
                        ? 'bg-warning/15 text-warning'
                        : 'bg-container2 text-muted')
                  }`}
                >
                  {currentJoined
                    ? `Joined "${trimmedRoom}" ✓`
                    : (joinedRooms.length === 0
                      ? 'Not joined to any rooms'
                      : `Joined: ${joinedRooms.join(', ')} (not "${trimmedRoom}")`)}
                </span>
              );
            })()}
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faPaperPlane}
          title="API — request → reply"
          intro={<><code className="font-mono">apiRequest</code> calls a server route and resolves with its result. No room needed — the response (and any stream) comes back to the caller only. Streaming is opt-in via the <code className="font-mono">onStream</code> key on the same call.</>}
        >
          <DemoCard
            tone="api"
            title="API echo"
            what="Sends your message to playground/echo; the server returns it."
            expect="The reply lands in YOUR log only — no other tab sees it."
          >
            <TextInput value={echoMessage} onChange={setEchoMessage} className="w-full" />
            <Btn icon={faPaperPlane} disabled={busy === 'apiEcho'} onClick={() => void handleApiEcho()}>Run API echo</Btn>
          </DemoCard>

          <DemoCard
            tone="api"
            title="API stream (counter)"
            what="The server streams 10 ticks back through the onStream callback."
            expect="Ten 'tick N/10' lines appear in YOUR log; other tabs see nothing."
          >
            <label className="flex items-center gap-2 text-xs text-common">
              <input type="checkbox" checked={showApiStreams} onChange={(event) => { setShowApiStreams(event.target.checked); }} />
              Log stream chunks
            </label>
            <Btn icon={faWaveSquare} variant="primary" disabled={busy === 'apiStream'} onClick={() => void handleApiStream()}>Run API stream</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faBroadcastTower}
          title="Sync — realtime, room-based, cross-tab"
          intro={<>One <code className="font-mono">syncRequest</code> reaches every tab in the room (across server instances). The three streaming emitters pick the audience: the whole room (<code className="font-mono">broadcastStream</code>), only the sender (originator <code className="font-mono">stream</code>), or specific sockets (<code className="font-mono">streamTo</code>).</>}
        >
          <DemoCard
            full
            tone="sync"
            title="Shared stream settings"
            what="Used by the broadcast + streamTo cards below."
          >
            <textarea
              value={streamText}
              onChange={(event) => { setStreamText(event.target.value); }}
              rows={2}
              className="w-full p-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors font-mono"
            />
            <label className="flex items-center gap-2 text-xs text-common">
              <input type="checkbox" checked={showSyncStreams} onChange={(event) => { setShowSyncStreams(event.target.checked); }} />
              Log sync stream chunks
            </label>
            <label className="flex items-center gap-2 text-xs text-common">
              <input type="checkbox" checked={useThrottle} onChange={(event) => { setUseThrottle(event.target.checked); }} />
              Use <code className="font-mono">createStreamThrottle</code>
            </label>
            <label className="flex items-center gap-2 text-xs text-common" title="Throttle window is 50ms / 16 chars. Set BELOW 50 to see batching.">
              Interval (ms):
              <input
                type="number"
                min={5}
                max={2000}
                value={streamIntervalMs}
                onChange={(event) => { setStreamIntervalMs(Math.max(5, Math.min(2000, Number(event.target.value) || 20))); }}
                className="h-7 w-20 px-2 rounded border border-container1-border bg-container1 text-title text-sm"
              />
            </label>
            <p className="text-xs text-muted w-full">
              Throttle only batches when tokens arrive <strong>faster</strong> than the 50ms / 16-char flush window — try interval <strong>≤ 20ms</strong> to watch tokens coalesce.
            </p>
          </DemoCard>

          <DemoCard
            tone="sync"
            title="Sync echo"
            what="Broadcasts your message to everyone in the room."
            expect="Every joined tab logs 'playground/echo received' — including other browsers."
          >
            <TextInput value={echoMessage} onChange={setEchoMessage} className="w-full" />
            <Btn icon={faPaperPlane} variant="correct" disabled={busy === 'syncEcho'} onClick={() => void handleSyncEcho()}>Run sync echo</Btn>
          </DemoCard>

          <DemoCard
            tone="sync"
            title="Broadcast stream"
            what="Streams the shared text token-by-token to the whole room, live."
            expect="Both tabs see 'broadcast chunk' lines as they arrive."
          >
            <Btn icon={faBroadcastTower} variant="correct" disabled={busy === 'syncBroadcast'} onClick={() => void handleSyncBroadcast()}>Run broadcastStream</Btn>
          </DemoCard>

          <DemoCard
            tone="sync"
            title="Originator-only stream"
            what="Streams progress back to ONLY you (the sender), not the room."
            expect="Only this tab logs 'progress N%'; other tabs see just the final summary."
          >
            <Btn icon={faWaveSquare} variant="correct" disabled={busy === 'syncProgress'} onClick={() => void handleSyncProgress()}>Run originator stream</Btn>
          </DemoCard>

          <DemoCard
            tone="sync"
            title="streamTo (targeted)"
            what="Streams ONLY to the socket ids you paste — even other tabs in the same room get nothing. Copy this tab's id, paste it into another tab here."
            expect="Only the targeted tab logs 'streamTo chunk'."
          >
            <span className="text-xs text-common self-center font-mono w-full">
              My socket id: {mySocketId || '— not connected —'}
            </span>
            <Btn variant="ghost" onClick={() => void handleCopySocketId()}>Copy my id</Btn>
            <TextInput value={streamToTargets} onChange={setStreamToTargets} placeholder="Comma-separated target socket ids" mono className="w-full" />
            <Btn icon={faPaperPlane} variant="correct" disabled={busy === 'syncStreamTo'} onClick={() => void handleSyncStreamTo()}>Run streamTo</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faShieldHalved}
          title="Auth, CSRF & OAuth"
          intro={<>Token mode is <code className="font-mono">{sessionBasedToken ? 'sessionStorage token' : 'HttpOnly cookie + CSRF'}</code> (set by <code className="font-mono">config.sessionBasedToken</code>). CSRF only applies in cookie mode — in token mode there&apos;s no cookie to ride on, so <code className="font-mono">getCsrfToken()</code> returns null.</>}
        >
          <DemoCard
            title="CSRF token"
            tone={sessionBasedToken ? 'default' : 'default'}
            what="Fetches the CSRF token (cookie mode only). httpFetch() attaches it automatically on writes; you only fetch it by hand for custom requests."
            expect={sessionBasedToken ? 'Disabled — token mode does not use CSRF.' : 'A 64-char hex token; cleared cache forces a re-fetch on next use.'}
          >
            <Btn icon={faShieldHalved} disabled={busy === 'csrf' || sessionBasedToken} onClick={() => void handleFetchCsrf()} title={sessionBasedToken ? 'Disabled: token mode does not use CSRF' : ''}>Fetch CSRF</Btn>
            <Btn variant="ghost" disabled={sessionBasedToken} onClick={handleClearCsrf}>Clear cache</Btn>
            <span className="text-xs text-muted self-center font-mono">
              {csrfTokenDisplay === null ? '— not fetched —' : `${csrfTokenDisplay.slice(0, 24)}…`}
            </span>
          </DemoCard>

          <DemoCard
            title="Forgot password + email diagnostic"
            what="'Send reset email' is the real anti-enumeration flow (always succeeds, hides why an email failed). 'Diagnostic' bypasses that and surfaces the real sendEmail() result."
            expect="With ConsoleSender the email prints in the server terminal; the diagnostic toast shows the provider result + reason."
          >
            <TextInput type="email" value={forgotEmail} onChange={setForgotEmail} placeholder="user@example.com" className="w-full" />
            <Btn icon={faEnvelope} disabled={busy === 'forgot'} onClick={() => void handleSendForgotPassword()} title="Real reset flow — anti-enumeration, always returns success">Send reset email</Btn>
            <Btn icon={faEnvelope} variant="ghost" disabled={busy === 'testEmail'} onClick={() => void handleSendTestEmail()} title="Diagnostic: surfaces real sendEmail() result + reason">Send diagnostic test</Btn>
          </DemoCard>

          <DemoCard
            full
            title={`OAuth providers (${String(oauthProviderIds.length)} from config.providers)`}
            what="Each button redirects to /auth/api/<provider> to start the OAuth dance (needs the provider's env creds configured)."
            expect="Browser redirects to the provider; on callback you land back logged in."
          >
            {oauthProviderIds.length === 0
              ? <span className="text-xs text-muted">No OAuth providers registered — add one in <code className="font-mono">config.providers</code>.</span>
              : oauthProviderIds.map((id) => (
                <Btn key={id} variant="ghost" icon={faLink} onClick={() => { handleOauthLaunch(id); }}>{id}</Btn>
              ))}
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faList}
          title="Settings APIs"
          intro={<>Real APIs under <code className="font-mono">src/settings/_api/</code>. Auth required — log in first or you&apos;ll get <code className="font-mono">auth.notLoggedIn</code>.</>}
        >
          <DemoCard
            title="List sessions"
            what="Fetches every active session for the current user (the multi-device overview that powers /settings)."
            expect="Your log shows the session array with expiry info."
          >
            <Btn icon={faList} disabled={busy === 'listSessions'} onClick={() => void handleListSessions()}>List sessions</Btn>
          </DemoCard>

          <DemoCard
            title="Email notifications"
            what="Flips notifyOnNewSignIn + notifyOnPasswordChange on the user. With ConsoleSender (default) the email prints in the server terminal."
            expect="A toast confirms; future sign-ins / password changes then trigger the emails."
          >
            <Btn icon={faUser} disabled={busy === 'prefs'} onClick={() => void handleUpdatePreferences(true)}>Enable</Btn>
            <Btn icon={faUser} variant="ghost" disabled={busy === 'prefs'} onClick={() => void handleUpdatePreferences(false)}>Disable</Btn>
          </DemoCard>

          <DemoCard
            full
            tone="danger"
            title="Account — password & sessions"
            what="Password change lives on the real /settings page (it needs your current password). 'Sign out everywhere' revokes ALL sessions including this one."
            expect="Sign-out-everywhere logs you out on the next request."
          >
            <a
              href="/settings"
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faKey} /> Change password (/settings)
            </a>
            <Btn icon={faSignOutAlt} variant="danger" disabled={busy === 'signOut'} onClick={() => void handleSignOutEverywhere()}>Sign out everywhere</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faBomb}
          title="Lifecycle hooks"
          intro={<>Each button forces a server-side hook to fire. Handlers live in <code className="font-mono">server/hooks/</code>; the payload is server-only (check the server console + Sentry). What lands in the log here is the normalized client response.</>}
        >
          <DemoCard
            tone="danger"
            title="apiError"
            what="Throws inside an API route, firing the apiError hook server-side."
            expect="Server logs the apiError hook; your log shows a normalized error envelope."
          >
            <Btn icon={faBomb} variant="danger" disabled={busy === 'throwError'} onClick={() => void handleTriggerApiError()}>Trigger apiError</Btn>
          </DemoCard>

          <DemoCard
            tone="danger"
            title="syncError"
            what="Throws inside a sync handler (needs a joined room), firing the syncError hook."
            expect="Server logs syncError; your log shows the normalized error."
          >
            <Btn icon={faBomb} variant="danger" disabled={busy === 'throwSync'} onClick={() => void handleTriggerSyncError()}>Trigger syncError</Btn>
          </DemoCard>

          <DemoCard
            tone="danger"
            title="rateLimitExceeded"
            what="Fires playground/spam (rateLimit 3) ten times in parallel."
            expect="First 3 succeed, the other 7 return rateLimit.exceeded — the hook fires per rejection."
          >
            <Btn icon={faStopwatch} variant="warning" disabled={busy === 'spam'} onClick={() => void handleRateLimitSpam()}>Spam ×10</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faHeartPulse}
          title="Health & ops endpoints"
          intro="The operator-facing probes a load balancer / Kubernetes hits, plus the dev fixture wipe."
        >
          <DemoCard
            full
            tone="default"
            title="Probes — /livez, /readyz, /_health"
            what={<><code className="font-mono">/livez</code> = process up (200 always). <code className="font-mono">/readyz</code> = Redis + Prisma + boot UUID all healthy (else 503). <code className="font-mono">/_health</code> = boot UUID + env hashes the router polls.</>}
            expect="200 when healthy; the toast names the failing subsystem on /readyz."
          >
            <Btn icon={faHeartPulse} variant="correct" disabled={busy === 'health:/livez'} onClick={() => void handleHealthFetch('/livez')}>/livez</Btn>
            <Btn icon={faHeartPulse} variant="correct" disabled={busy === 'health:/readyz'} onClick={() => void handleHealthFetch('/readyz')}>/readyz</Btn>
            <Btn icon={faHeartPulse} variant="correct" disabled={busy === 'health:/_health'} onClick={() => void handleHealthFetch('/_health')}>/_health</Btn>
          </DemoCard>

          <DemoCard
            full
            tone="danger"
            title="/_test/reset — dev fixture wipe"
            what="Clears Redis rate-limit counters, sessions and active-user keys so e2e scripts start clean. Fail-closed: needs NODE_ENV dev/test + a matching x-test-reset-token. 403 in production."
            expect="200 + 'cleared' in dev; 403 when the gate isn't satisfied."
          >
            <Btn icon={faRotateRight} variant="warning" disabled={busy === 'testReset'} onClick={() => void handleTestReset()}>POST /_test/reset</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faPlugCircleXmark}
          title="Offline queue"
          intro={<>While the socket is down, <code className="font-mono">syncRequest</code> / <code className="font-mono">apiRequest</code> calls park in the offline queue (drop policy + max size from project config). Reconnecting auto-flushes both queues in order.</>}
          cols={1}
        >
          <DemoCard
            full
            title="Disconnect → enqueue → replay"
            what="Disconnect the socket, fire 5 syncs (they queue instead of sending), then reconnect to watch them replay."
            expect="The queue counters climb while offline, then drain to 0 on reconnect."
          >
            <span className="text-xs text-common self-center">Offline: <strong>{offlineSimulated ? 'YES' : 'no'}</strong></span>
            <span className="text-xs text-common self-center">API queue: <strong>{String(apiQueueSize)}</strong></span>
            <span className="text-xs text-common self-center">Sync queue: <strong>{String(syncQueueSize)}</strong></span>
            <span className="w-full" />
            <Btn icon={offlineSimulated ? faWifi : faPlugCircleXmark} variant={offlineSimulated ? 'correct' : 'danger'} onClick={handleToggleOffline}>
              {offlineSimulated ? 'Reconnect (flush queue)' : 'Disconnect (start queueing)'}
            </Btn>
            <Btn icon={faBolt} variant="warning" disabled={busy === 'queueFill'} onClick={handleEnqueueOffline}>Fire 5 syncRequests</Btn>
          </DemoCard>
        </CardGroup>

        <CardGroup
          icon={faWifi}
          title="Presence & session"
          intro={<><code className="font-mono">@luckystack/presence</code> tracks connect / disconnect / AFK at the server; the <code className="font-mono">SocketStatusIndicator</code> is the client surface. Read-only here.</>}
          cols={1}
        >
          <DemoCard
            full
            title="Joined rooms (this tab)"
            what="Open this page in two tabs, Join in both, then close one. The other tab's SocketStatusIndicator flips to a degraded state within the presence disconnectGraceMs window."
            expect="The room list below mirrors what this tab joined this session."
          >
            <span className="text-xs text-common self-center font-mono">
              {joinedRooms.length === 0 ? '— none —' : joinedRooms.join(', ')}
            </span>
          </DemoCard>
        </CardGroup>

        <div className="flex flex-col gap-1 pt-2">
          <h2 className="text-lg font-semibold text-title flex items-center gap-2">
            <FontAwesomeIcon icon={faPlus} className="text-primary" /> UI components &amp; primitives
          </h2>
          <p className="text-sm text-common max-w-3xl leading-relaxed">
            The reusable building blocks shipped in <code className="font-mono">src/_components/</code> — buttons, inputs,
            avatars, dropdowns, dialogs, toasts, the spinner, and the live theme tokens. Pure visual demos (no backend).
          </p>
        </div>

        <Section title="Buttons">
          <Row label="Variants">
            <button type="button" className="h-9 px-4 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer">
              Primary
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer">
              Secondary
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer">
              Destructive
            </button>
            <button type="button" disabled className="h-9 px-4 rounded-md bg-primary text-white text-sm font-medium opacity-50 cursor-not-allowed">
              Disabled
            </button>
          </Row>
          <Row label="With icon">
            <button type="button" className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2">
              <FontAwesomeIcon icon={faPlus} /> New item
            </button>
            <button type="button" className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2">
              <FontAwesomeIcon icon={faTrash} /> Remove
            </button>
          </Row>
        </Section>

        <Section title="Inputs">
          <Row label="Text input">
            <input
              type="text"
              placeholder="Type something..."
              className="h-9 w-64 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </Row>
          <Row label="Disabled">
            <input
              type="text"
              disabled
              defaultValue="Locked input"
              className="h-9 w-64 px-3 rounded-md border border-container1-border bg-container2 text-common text-sm cursor-not-allowed opacity-60"
            />
          </Row>
        </Section>

        <Section title="Avatars">
          <Row label="Sizes (image when valid, fallback letter otherwise)">
            <div className="w-8 h-8"><Avatar user={{ name: 'Alice', avatarFallback: '#ef4444' }} textSize="text-sm" /></div>
            <div className="w-12 h-12"><Avatar user={{ name: 'Bob', avatarFallback: '#3b82f6' }} textSize="text-base" /></div>
            <div className="w-16 h-16"><Avatar user={{ name: 'Carol', avatarFallback: '#10b981' }} textSize="text-xl" /></div>
            <div className="w-24 h-24"><Avatar user={{ name: 'Diego', avatarFallback: '#f59e0b' }} textSize="text-3xl" /></div>
          </Row>
          <Row label="Image fallback (broken URL → falls back to letter automatically)">
            <div className="w-12 h-12">
              <Avatar user={{ name: 'Eve', avatar: 'https://example.invalid/missing.png', avatarFallback: '#8b5cf6' }} />
            </div>
          </Row>
        </Section>

        <Section title="Dropdown — single select">
          <Row label="Default (full width, no search)">
            <Dropdown items={ROLES} placeholder="Pick a role…" />
          </Row>
          <Row label="With size + search (long list, keyboard nav: ↑/↓/Home/End/Enter/Escape)">
            <Dropdown items={COUNTRIES} size="md" placeholder="Pick a country…" showSearch searchPlaceholder="Search countries…" />
          </Row>
          <Row label="Sizes side by side">
            <Dropdown items={ROLES} size="sm" placeholder="sm" />
            <Dropdown items={ROLES} size="md" placeholder="md" />
            <Dropdown items={ROLES} size="lg" placeholder="lg" />
            <Dropdown items={ROLES} size="xl" placeholder="xl" />
          </Row>
          <Row label="With a default value">
            <Dropdown items={ROLES} size="md" defaultValue={ROLES[2]} />
          </Row>
        </Section>

        <Section title="MultiSelect dropdown">
          <Row label="With search and 18 items">
            <MultiSelectDropdown
              items={COUNTRIES}
              size="lg"
              placeholder="Pick countries…"
              showSearch
              searchPlaceholder="Search…"
              selectedCountText={(n) => `${String(n)} countries selected`}
            />
          </Row>
          <Row label="Close on each select">
            <MultiSelectDropdown items={ROLES} size="md" placeholder="Pick roles…" closeOnSelect />
          </Row>
        </Section>

        <Section title="Confirm dialogs (menuHandler.confirm)">
          <Row label="Click to open">
            <button type="button" className="h-9 px-4 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer" onClick={() => void handleConfirmBasic()}>
              Basic confirm
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer" onClick={() => void handleConfirmTyped()}>
              Typed confirm (DELETE)
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer" onClick={handleStackedMenu}>
              Stacked menus
            </button>
          </Row>
        </Section>

        <Section title="Notifications (sonner via notify)">
          <Row label="Trigger each level">
            <button type="button" className="h-9 px-4 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2" onClick={() => { toast.success('Saved successfully'); }}>
              <FontAwesomeIcon icon={faCircleCheck} /> Success
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-warning hover:bg-warning-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2" onClick={() => { toast.warning('Heads up — check this'); }}>
              <FontAwesomeIcon icon={faTriangleExclamation} /> Warning
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2" onClick={() => { toast.error('Something went wrong'); }}>
              <FontAwesomeIcon icon={faCircleExclamation} /> Error
            </button>
            <button type="button" className="h-9 px-4 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2" onClick={() => { toast.info('Just so you know'); }}>
              <FontAwesomeIcon icon={faCircleInfo} /> Info
            </button>
          </Row>
        </Section>

        <Section title="Spinner (matches the Middleware loader)">
          <Row>
            <div className="w-8 h-8 rounded-full border-2 border-container2-border border-t-primary animate-spin" />
            <div className="w-12 h-12 rounded-full border-2 border-container2-border border-t-primary animate-spin" />
            <div className="w-16 h-16 rounded-full border-2 border-container2-border border-t-primary animate-spin" />
          </Row>
        </Section>

        <Section title="Color tokens (current theme)">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {COLOR_TOKENS.map((token) => (
              <div key={token} className="flex flex-col gap-1">
                <div
                  className="h-12 rounded-md border border-container1-border"
                  style={{ backgroundColor: `var(--color-${token})` }}
                  aria-label={token}
                />
                <div className="text-xs font-mono text-common">{token}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Error boundary (renders ErrorPage)">
          <Row label="Throws — React Router catches it and shows ErrorPage. Use back button to return.">
            <button
              type="button"
              className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer"
              onClick={handleErrorPagePreview}
            >
              Throw a render error
            </button>
          </Row>
        </Section>

      </div>

      {/*
        Fixed live-log drawer pinned to the bottom of the viewport so every
        button on this page has visible feedback regardless of scroll position.
        Collapses to a 40px strip showing the most recent entry + count;
        expands to a 320px scrollable panel mirroring the previous inline log.
      */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-30 bg-container1 border-t border-container1-border shadow-[0_-2px_12px_rgba(0,0,0,0.18)] flex flex-col transition-[height] duration-150 ${drawerHeightClass}`}
        role="region"
        aria-label="Playground live log"
      >
        <div className="h-10 flex-shrink-0 flex items-center gap-3 px-4 border-b border-container1-border">
          <button
            type="button"
            onClick={() => { setLogExpanded((prev) => !prev); }}
            className="h-7 px-2 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-xs font-medium transition-colors cursor-pointer flex items-center gap-2"
            aria-expanded={logExpanded}
          >
            <FontAwesomeIcon icon={logExpanded ? faChevronDown : faChevronUp} />
            {logExpanded ? 'Collapse log' : 'Expand log'}
          </button>
          <span className="text-xs text-common font-mono">
            {String(logs.length)} / 250 entries
          </span>
          {!logExpanded && lastLog && (
            <span className="flex-1 min-w-0 flex items-center gap-2 text-xs font-mono">
              <span className="text-disabled flex-shrink-0">{lastLog.ts}</span>
              <span className={`flex-shrink-0 px-1.5 rounded ${channelLabel[lastLog.channel].tone}`}>
                {channelLabel[lastLog.channel].label}
              </span>
              <span className="text-title truncate">
                {lastLog.message}
                {lastLog.payload !== undefined && (
                  <span className="text-muted ml-2">{formatPayload(lastLog.payload)}</span>
                )}
              </span>
            </span>
          )}
          {logExpanded && (
            <button
              type="button"
              onClick={() => { setLogs([]); }}
              className="ml-auto h-7 px-2 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-xs font-medium transition-colors cursor-pointer"
            >
              Clear log
            </button>
          )}
        </div>
        {logExpanded && (
          <div
            ref={logScrollRef}
            className="flex-1 overflow-y-auto bg-container2 p-2 font-mono text-xs flex flex-col gap-1"
          >
            {logs.length === 0 ? (
              <div className="text-muted p-4 text-center">
                Empty. Fire any button above and this drawer will fill with timestamped events.
              </div>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2">
                  <span className="text-disabled flex-shrink-0">{entry.ts}</span>
                  <span className={`flex-shrink-0 px-1.5 rounded ${channelLabel[entry.channel].tone}`}>
                    {channelLabel[entry.channel].label}
                  </span>
                  <span className="text-title flex-1 break-all">
                    {entry.message}
                    {entry.payload !== undefined && (
                      <span className="text-muted ml-2">{formatPayload(entry.payload)}</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
