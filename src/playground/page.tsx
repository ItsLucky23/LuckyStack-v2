/* eslint-disable react/jsx-no-literals -- temporary playground page; delete this file when done. */
import {
  faBolt,
  faBomb,
  faBroadcastTower,
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
import { toast } from 'sonner';
import { useEffect, useRef, useState } from 'react';

import {
  getCsrfToken,
  clearCsrfToken,
  httpFetch,
  socket,
  getApiQueueSize,
  getSyncQueueSize,
} from '@luckystack/core/client';

import Avatar from 'src/_components/Avatar';
import Dropdown, { type DropdownItem } from 'src/_components/Dropdown';
import MultiSelectDropdown from 'src/_components/MultiSelectDropdown';
import { menuHandler } from 'src/_functions/menuHandler';
import { apiRequest } from 'src/_sockets/apiRequest';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { providers as oauthProviderIds, backendUrl } from 'config';

export const template = 'dashboard';

//? TEMPORARY playground page for visually testing framework components.
//? Delete this folder + the matching nav item in `Navbar.tsx` when done.

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
    | 'upload'
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
    return String(payload);
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
  'upload': { label: 'upload', tone: 'bg-warning/15 text-warning' },
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

  //? Auxiliary state for the feature sections below the test bench.
  const [csrfTokenDisplay, setCsrfTokenDisplay] = useState<string | null>(null);
  const [forgotEmail, setForgotEmail] = useState<string>('');
  const [avatarFileInfo, setAvatarFileInfo] = useState<string>('');
  const [offlineSimulated, setOfflineSimulated] = useState<boolean>(false);
  const [apiQueueSize, setApiQueueSize] = useState<number>(0);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);

  const showApiStreamsRef = useRef(showApiStreams);
  showApiStreamsRef.current = showApiStreams;
  const showSyncStreamsRef = useRef(showSyncStreams);
  showSyncStreamsRef.current = showSyncStreams;
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  //? Live queue-size poll while the test bench is open. Cheap — single
  //? interval reading two getters. Stops when the page unmounts.
  useEffect(() => {
    const handle = window.setInterval(() => {
      setApiQueueSize(getApiQueueSize());
      setSyncQueueSize(getSyncQueueSize());
    }, 500);
    return () => { window.clearInterval(handle); };
  }, []);

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
      return next.length > 250 ? next.slice(next.length - 250) : next;
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
        if (serverOutput.status !== 'success') return;
        log('sync', `playground/echo received`, serverOutput);
      },
    });
    return () => { teardownEcho?.(); };
  }, [upsertSyncEventCallback]);

  useEffect(() => {
    const teardownBroadcast = upsertSyncEventCallback({
      name: 'playground/streamBroadcast',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (serverOutput.status !== 'success') return;
        log('sync', `streamBroadcast complete`, serverOutput);
      },
    });
    return () => { teardownBroadcast?.(); };
  }, [upsertSyncEventCallback]);

  useEffect(() => {
    const teardownProgress = upsertSyncEventCallback({
      name: 'playground/streamProgress',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (serverOutput.status !== 'success') return;
        log('sync', `streamProgress complete`, serverOutput);
      },
    });
    return () => { teardownProgress?.(); };
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
    return () => { teardown?.(); };
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
    return () => { teardown?.(); };
  }, [upsertSyncEventStreamCallback]);

  //? Stash this tab's socket id so the streamTo demo can show "Copy socket id"
  //? — paste into another tab's target field to direct chunks at this tab.
  useEffect(() => {
    const handle = window.setInterval(() => {
      const id = socket?.id ?? '';
      setMySocketId((prev) => (prev === id ? prev : id));
    }, 300);
    return () => { window.clearInterval(handle); };
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
    if (response.status === 'success') {
      log('api', `← playground/echo`, response.result);
    } else {
      log('api', `← playground/echo error`, response);
    }
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
    if (response.status === 'success') {
      log('api', `← streamCounter complete`, response.result);
    } else {
      log('api', `← streamCounter error`, response);
    }
  };

  const requireRoom = (): string | null => {
    const trimmed = roomCode.trim();
    if (!trimmed) {
      toast.error('Enter + join a room first.');
      return null;
    }
    if (!joinedRooms.includes(trimmed)) {
      toast.warning(`You haven't joined "${trimmed}" yet — recipients in that room (including this tab) won't receive sync events. Click Join first.`);
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
          log('sync-stream', `progress ${String(chunk.progress)}% (${String(chunk.phase)})`);
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

  const handleOauthLaunch = (providerId: string) => {
    log('auth', `Redirecting to /auth/api/${providerId}`);
    window.location.href = `${backendUrl}/auth/api/${providerId}`;
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

  const handleUpdatePreferences = async () => {
    setBusy('prefs');
    log('settings', `→ settings/updatePreferences {notifyOnNewSignIn: true}`);
    const response = await apiRequest({
      name: 'settings/updatePreferences',
      version: 'v1',
      data: { preferences: { notifyOnNewSignIn: true, notifyOnPasswordChange: true } },
    });
    setBusy(null);
    log('settings', `← updatePreferences`, response);
  };

  const handleChangePassword = async () => {
    const current = await menuHandler.confirm({
      title: 'Change password (demo)',
      content: 'Type your current password — then a new one. This will revoke other sessions on success.',
      input: '',
    });
    if (!current) return;
    log('settings', `change-password flow opened (real form lives in /settings)`);
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
    const successes = responses.filter((r) => r.status === 'success').length;
    const blocked = responses.length - successes;
    log('hook', `← ${String(successes)} ok / ${String(blocked)} rate-limited`, responses.map((r) => r.status));
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
      } catch (e) {
        return [e as Error, { status: 0, body: null }];
      }
    })();
    setBusy(null);
    if (error) {
      log('health', `← ${path} fetch error: ${error.message}`);
    } else {
      log('health', `← ${path} ${String(body.status)}`, body.body);
    }
  };

  // ───────────────────────── Upload (avatar) ─────────────────────────
  const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(String(reader.result ?? '')); };
    reader.onerror = () => { reject(new Error('file read failed')); };
    reader.readAsDataURL(file);
  });

  const handleAvatarPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFileInfo(`${file.name} (${String(Math.round(file.size / 1024))} KB)`);
    setBusy('upload');
    log('upload', `→ encoding ${file.name}`);
    let dataUrl: string;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      setBusy(null);
      log('upload', `← file read failed`);
      return;
    }
    log('upload', `→ settings/updateUser {avatar: base64 ${String(dataUrl.length)} chars}`);
    const response = await apiRequest({
      name: 'settings/updateUser',
      version: 'v1',
      data: { avatar: dataUrl },
    });
    setBusy(null);
    log('upload', `← updateUser`, response);
    //? Force re-render so the avatar element below picks up the new URL.
    if (response.status === 'success') {
      window.location.reload();
    }
  };

  const handleClearAvatar = async () => {
    setBusy('clearAvatar');
    log('upload', `→ settings/updateUser {avatar: null}`);
    const response = await apiRequest({
      name: 'settings/updateUser',
      version: 'v1',
      data: {},
    });
    setBusy(null);
    log('upload', `← clear avatar`, response);
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

  const handleEnqueueOffline = async () => {
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
      title: '/_test/reset?',
      content: 'Clears rateLimits, sessions, activeUsers. Dev/test only. Requires TEST_RESET_TOKEN if set.',
    });
    if (!confirmed) return;
    setBusy('testReset');
    log('health', `→ POST /_test/reset`);
    const res = await httpFetch(`${backendUrl}/_test/reset`, { method: 'POST' });
    const body = await res.json().catch(() => ({ raw: 'non-JSON' }));
    setBusy(null);
    log('health', `← ${String(res.status)}`, body);
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6 flex flex-col gap-5">

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-title">Playground</h1>
          <p className="text-sm text-common">
            Temporary page for testing every framework component. Delete <code className="font-mono text-xs px-1 rounded bg-container2">src/playground/</code> and the Playground entry in <code className="font-mono text-xs px-1 rounded bg-container2">Navbar.tsx</code> when finished.
          </p>
        </header>

        <Section title="Test bench — API + sync + rooms (multi-browser)">
          <p className="text-xs text-common">
            Open this page in two browsers. Type the same room code in both, click <strong>Join</strong> in each, then fire any sync button. The log below shows what each tab receives — you should see the same broadcast chunks land in both windows.
          </p>

          <Row label="Room">
            <input
              type="text"
              value={roomCode}
              onChange={(event) => { setRoomCode(event.target.value); }}
              placeholder="room-code"
              className="h-9 w-56 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
            <button
              type="button"
              disabled={busy === 'join'}
              onClick={() => void handleJoinRoom()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
            >
              <FontAwesomeIcon icon={faDoorOpen} /> Join
            </button>
            <button
              type="button"
              disabled={busy === 'leave'}
              onClick={() => void handleLeaveRoom()}
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Leave
            </button>
            <span className="text-xs text-muted">
              {joinedRooms.length === 0
                ? 'Not joined to any rooms.'
                : `Joined: ${joinedRooms.join(', ')}`}
            </span>
          </Row>

          <Row label="Echo message (used by API echo + sync echo)">
            <input
              type="text"
              value={echoMessage}
              onChange={(event) => { setEchoMessage(event.target.value); }}
              className="h-9 w-96 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </Row>

          <Row label="Stream text (used by broadcast stream — pretend AI output)">
            <textarea
              value={streamText}
              onChange={(event) => { setStreamText(event.target.value); }}
              rows={2}
              className="w-full p-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors font-mono"
            />
          </Row>

          <Row label="Stream options">
            <label className="flex items-center gap-2 text-sm text-common">
              <input
                type="checkbox"
                checked={showApiStreams}
                onChange={(event) => { setShowApiStreams(event.target.checked); }}
              />
              Log API stream chunks
            </label>
            <label className="flex items-center gap-2 text-sm text-common">
              <input
                type="checkbox"
                checked={showSyncStreams}
                onChange={(event) => { setShowSyncStreams(event.target.checked); }}
              />
              Log sync stream chunks
            </label>
            <label className="flex items-center gap-2 text-sm text-common">
              <input
                type="checkbox"
                checked={useThrottle}
                onChange={(event) => { setUseThrottle(event.target.checked); }}
              />
              Use <code className="font-mono text-xs">createStreamThrottle</code> on broadcast
            </label>
            <label className="flex items-center gap-2 text-sm text-common" title="Throttle window is 50ms / 16 chars. Set this BELOW 50 to actually see batching.">
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
          </Row>

          <p className="text-xs text-muted">
            Throttle tip: the throttle's flush window is <code className="font-mono">50ms / 16 chars</code>. If your interval is <strong>≥ 50ms</strong> the timer fires before the next token arrives — you'll see one chunk per token even with throttle on. Try <strong>20ms or below</strong> to watch tokens batch.
          </p>

          <Row label="streamTo (token-targeted — paste another tab's socket id here)">
            <span className="text-xs text-common self-center font-mono">
              My socket id: {mySocketId || '— not connected —'}
            </span>
            <button
              type="button"
              onClick={() => void handleCopySocketId()}
              className="h-7 px-2 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-xs font-medium transition-colors cursor-pointer"
            >
              Copy
            </button>
            <input
              type="text"
              value={streamToTargets}
              placeholder="Comma-separated target tokens / socket ids"
              onChange={(event) => { setStreamToTargets(event.target.value); }}
              className="h-9 w-96 px-3 rounded-md border border-container1-border bg-container1 text-title text-xs font-mono focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </Row>

          <Row label="Fire">
            <button
              type="button"
              disabled={busy === 'apiEcho'}
              onClick={() => void handleApiEcho()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPaperPlane} /> API echo
            </button>
            <button
              type="button"
              disabled={busy === 'apiStream'}
              onClick={() => void handleApiStream()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faWaveSquare} /> API stream (counter)
            </button>
            <button
              type="button"
              disabled={busy === 'syncEcho'}
              onClick={() => void handleSyncEcho()}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPaperPlane} /> Sync echo
            </button>
            <button
              type="button"
              disabled={busy === 'syncBroadcast'}
              onClick={() => void handleSyncBroadcast()}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faBroadcastTower} /> Sync broadcastStream
            </button>
            <button
              type="button"
              disabled={busy === 'syncProgress'}
              onClick={() => void handleSyncProgress()}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faWaveSquare} /> Sync stream (originator-only)
            </button>
            <button
              type="button"
              disabled={busy === 'syncStreamTo'}
              onClick={() => void handleSyncStreamTo()}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPaperPlane} /> Sync streamTo (target tokens)
            </button>
            <button
              type="button"
              onClick={() => { setLogs([]); }}
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer"
            >
              Clear log
            </button>
          </Row>

          <Row label={`Live log (${String(logs.length)} / 250)`}>
            <div
              ref={logScrollRef}
              className="w-full max-h-72 overflow-y-auto bg-container2 border border-container2-border rounded-md p-2 font-mono text-xs flex flex-col gap-1"
            >
              {logs.length === 0 ? (
                <div className="text-muted p-4 text-center">
                  Empty. Fire any button above and this panel will fill with timestamped events.
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
          </Row>
        </Section>

        <Section title="Auth & CSRF & OAuth providers">
          <p className="text-xs text-common">
            <code className="font-mono">getCsrfToken()</code> lazily fetches <code className="font-mono">/auth/csrf</code> in cookie mode (returns <code className="font-mono">null</code> in token mode — CSRF-immune by design). <code className="font-mono">httpFetch()</code> auto-attaches the header on POST/PUT/DELETE.
          </p>
          <Row label="CSRF token">
            <button
              type="button"
              disabled={busy === 'csrf'}
              onClick={() => void handleFetchCsrf()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faShieldHalved} /> Fetch CSRF
            </button>
            <button
              type="button"
              onClick={handleClearCsrf}
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer"
            >
              Clear cache
            </button>
            <span className="text-xs text-muted self-center font-mono">
              {csrfTokenDisplay === null ? '— not fetched —' : `${csrfTokenDisplay.slice(0, 24)}…`}
            </span>
          </Row>

          <Row label="Forgot-password (anti-enumeration: always success)">
            <input
              type="email"
              value={forgotEmail}
              placeholder="user@example.com"
              onChange={(event) => { setForgotEmail(event.target.value); }}
              className="h-9 w-64 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
            <button
              type="button"
              disabled={busy === 'forgot'}
              onClick={() => void handleSendForgotPassword()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faEnvelope} /> Send reset email
            </button>
          </Row>

          <Row label={`Registered OAuth providers (from config.providers — ${String(oauthProviderIds.length)} entries)`}>
            {oauthProviderIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => { handleOauthLaunch(id); }}
                className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
              >
                <FontAwesomeIcon icon={faLink} /> {id}
              </button>
            ))}
          </Row>
        </Section>

        <Section title="Settings flows (system/* APIs)">
          <p className="text-xs text-common">
            These call real APIs under <code className="font-mono">src/settings/_api/</code>. Auth required — log in first or you will see <code className="font-mono">auth.notLoggedIn</code>.
          </p>
          <Row label="Run">
            <button
              type="button"
              disabled={busy === 'listSessions'}
              onClick={() => void handleListSessions()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faList} /> List sessions
            </button>
            <button
              type="button"
              disabled={busy === 'prefs'}
              onClick={() => void handleUpdatePreferences()}
              className="h-9 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faUser} /> Update prefs (notify-on-* = true)
            </button>
            <button
              type="button"
              disabled={busy === 'changePw'}
              onClick={() => void handleChangePassword()}
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faKey} /> Change password (demo prompt)
            </button>
            <button
              type="button"
              disabled={busy === 'signOut'}
              onClick={() => void handleSignOutEverywhere()}
              className="h-9 px-3 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faSignOutAlt} /> Sign out everywhere
            </button>
          </Row>
        </Section>

        <Section title="Hooks demo — trigger framework lifecycle hooks">
          <p className="text-xs text-common">
            Each button forces a server-side hook to fire. The hook handlers themselves live in <code className="font-mono">server/hooks/</code> (notifications, Sentry capture, etc.). What lands in this log is the normalized client response — the hook payload itself is server-only. Check the server console + Sentry to see the dispatched payloads.
          </p>
          <Row label="Triggers">
            <button
              type="button"
              disabled={busy === 'throwError'}
              onClick={() => void handleTriggerApiError()}
              className="h-9 px-3 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faBomb} /> apiError (throw inside API)
            </button>
            <button
              type="button"
              disabled={busy === 'throwSync'}
              onClick={() => void handleTriggerSyncError()}
              className="h-9 px-3 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faBomb} /> syncError (throw inside sync)
            </button>
            <button
              type="button"
              disabled={busy === 'spam'}
              onClick={() => void handleRateLimitSpam()}
              className="h-9 px-3 rounded-md bg-warning hover:bg-warning-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faStopwatch} /> rateLimitExceeded (spam playground/spam ×10)
            </button>
          </Row>
        </Section>

        <Section title="Health & test-reset endpoints">
          <p className="text-xs text-common">
            <code className="font-mono">/livez</code> is process-up (200 always); <code className="font-mono">/readyz</code> checks Redis + Prisma + boot UUID (503 if degraded); <code className="font-mono">/_health</code> exposes boot UUID + synchronized env hashes for the router handshake. <code className="font-mono">/_test/reset</code> is gated by <code className="font-mono">NODE_ENV</code> + <code className="font-mono">TEST_RESET_TOKEN</code>.
          </p>
          <Row label="Probes">
            <button
              type="button"
              disabled={busy === 'health:/livez'}
              onClick={() => void handleHealthFetch('/livez')}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faHeartPulse} /> /livez
            </button>
            <button
              type="button"
              disabled={busy === 'health:/readyz'}
              onClick={() => void handleHealthFetch('/readyz')}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faHeartPulse} /> /readyz
            </button>
            <button
              type="button"
              disabled={busy === 'health:/_health'}
              onClick={() => void handleHealthFetch('/_health')}
              className="h-9 px-3 rounded-md bg-correct hover:bg-correct-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faHeartPulse} /> /_health
            </button>
            <button
              type="button"
              disabled={busy === 'testReset'}
              onClick={() => void handleTestReset()}
              className="h-9 px-3 rounded-md bg-warning hover:bg-warning-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faRotateRight} /> POST /_test/reset
            </button>
          </Row>
        </Section>

        <Section title="File upload — avatar via processUpload">
          <p className="text-xs text-common">
            Encodes the picked file to base64 and submits to <code className="font-mono">system/updateUser</code>. The endpoint runs <code className="font-mono">processUpload</code> which dispatches <code className="font-mono">onUploadStart</code> / <code className="font-mono">onUploadComplete</code> hooks around the Sharp encode step. Auth required.
          </p>
          <Row label="Pick a file">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => void handleAvatarPicked(event)}
              className="text-xs text-common file:mr-3 file:h-9 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-white file:cursor-pointer hover:file:bg-primary-hover"
            />
            <button
              type="button"
              disabled={busy === 'clearAvatar'}
              onClick={() => void handleClearAvatar()}
              className="h-9 px-3 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faTrash} /> Clear avatar field
            </button>
            <span className="text-xs text-muted self-center">
              {avatarFileInfo || '— no file picked yet —'}
            </span>
          </Row>
        </Section>

        <Section title="Offline queue — disconnect, enqueue, replay">
          <p className="text-xs text-common">
            <code className="font-mono">socket.disconnect()</code> makes <code className="font-mono">canSendNow()</code> return false; subsequent <code className="font-mono">syncRequest</code> / <code className="font-mono">apiRequest</code> calls drop into <code className="font-mono">offlineQueue</code> (drop policy + max-size from project config). <code className="font-mono">socket.connect()</code> auto-flushes both queues.
          </p>
          <Row label="State">
            <span className="text-xs text-common self-center">
              Simulated offline: <strong>{offlineSimulated ? 'YES' : 'no'}</strong>
            </span>
            <span className="text-xs text-common self-center">
              API queue: <strong>{String(apiQueueSize)}</strong>
            </span>
            <span className="text-xs text-common self-center">
              Sync queue: <strong>{String(syncQueueSize)}</strong>
            </span>
          </Row>
          <Row label="Actions">
            <button
              type="button"
              onClick={handleToggleOffline}
              className={`h-9 px-3 rounded-md text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 ${offlineSimulated ? 'bg-correct hover:bg-correct-hover' : 'bg-wrong hover:bg-wrong-hover'}`}
            >
              <FontAwesomeIcon icon={offlineSimulated ? faWifi : faPlugCircleXmark} />
              {offlineSimulated ? 'Reconnect (auto-flush queue)' : 'Disconnect (start queueing)'}
            </button>
            <button
              type="button"
              disabled={busy === 'queueFill'}
              onClick={() => void handleEnqueueOffline()}
              className="h-9 px-3 rounded-md bg-warning hover:bg-warning-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faBolt} /> Fire 5 syncRequests (watch queue grow)
            </button>
          </Row>
        </Section>

        <Section title="Presence & session — read-only observers">
          <p className="text-xs text-common">
            <code className="font-mono">@luckystack/presence</code> tracks socket connect / disconnect / AFK at the server. The <code className="font-mono">SocketStatusIndicator</code> component is the public client surface. Hooks: <code className="font-mono">prePresenceUpdate</code> / <code className="font-mono">postPresenceUpdate</code> fire on AFK transitions; <code className="font-mono">onSocketConnect</code> / <code className="font-mono">onSocketDisconnect</code> fire at the transport layer. The room list below mirrors what this tab has joined this session.
          </p>
          <Row label="Joined rooms">
            <span className="text-xs text-common self-center font-mono">
              {joinedRooms.length === 0 ? '— none —' : joinedRooms.join(', ')}
            </span>
          </Row>
          <Row label="Tip">
            <span className="text-xs text-muted">
              Open this page in two tabs, click <strong>Join</strong> in both, then close one tab. The other tab's
              SocketStatusIndicator should flip to a degraded state within the presence package's
              <code className="font-mono"> disconnectGraceMs</code> window.
            </span>
          </Row>
        </Section>

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
    </div>
  );
}
