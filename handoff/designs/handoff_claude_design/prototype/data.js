/* Workspaces UI kit — seed data (mirrors README §6). Exposed on window. */
window.WS_MEMBERS = {
  mathijs: { id: 'mathijs', name: 'Mathijs', avatarFallback: '#6366F1', role: 'Owner' },
  sanne:   { id: 'sanne',   name: 'Sanne',   avatarFallback: '#0EA5A4', role: 'Admin' },
  tom:     { id: 'tom',     name: 'Tom',     avatarFallback: '#E0920A', role: 'Member' },
  lina:    { id: 'lina',    name: 'Lina',    avatarFallback: '#E5484D', role: 'Member' },
  daan:    { id: 'daan',    name: 'Daan',    avatarFallback: '#16A34A', role: 'Member' },
};

window.WS_STAGES = [
  { id: 'unrefined', name: 'Unrefined', ai: false },
  { id: 'refined',   name: 'Refined',   ai: true },
  { id: 'plan',      name: 'Plan',      ai: true },
  { id: 'impl',      name: 'Implementatie', ai: true },
  { id: 'test',      name: 'Test',      ai: true },
  { id: 'review',    name: 'Review',    ai: true },
  { id: 'final',     name: 'Final',     ai: true },
];

// status: 'needs-input' | 'busy' | 'done' | 'idle'
window.WS_TICKETS = [
  { id: 'DEV-1240', title: 'Fix avatar fallback flicker on slow networks', stage: 'impl',   status: 'busy', terminal: true,  labels: ['bug','frontend'], viewers: ['sanne','tom'] },
  { id: 'DEV-1245', title: 'Board drag-and-drop with dnd-kit',             stage: 'impl',   status: 'busy', terminal: true,  labels: ['feature','frontend'], viewers: ['mathijs'], terminalTabs: ['server','client','claude'] },
  { id: 'DEV-1242', title: 'Refactor rate limiter to token bucket',        stage: 'review', status: 'busy', terminal: true,  labels: ['backend','perf'], viewers: ['daan'] },
  { id: 'DEV-1241', title: 'Add SSO via Microsoft',                        stage: 'plan',   status: 'needs-input', terminal: false, labels: ['feature','auth'], viewers: ['sanne'] },
  { id: 'DEV-1247', title: 'graphify MCP: impact_of endpoint',             stage: 'plan',   status: 'busy', terminal: false, labels: ['mcp','backend'], viewers: [] },
  { id: 'DEV-1249', title: 'Per-workspace GitLab token vault',             stage: 'plan',   status: 'busy', terminal: false, labels: ['security','backend'], viewers: ['tom'] },
  { id: 'DEV-1244', title: 'Dark mode FOUC on unauth reload',              stage: 'test',   status: 'busy', terminal: false, labels: ['bug','frontend'], viewers: [] },
  { id: 'DEV-1243', title: 'Voice note → ticket pipeline',                 stage: 'refined',status: 'done', terminal: false, labels: ['feature','mobile'], viewers: ['lina'] },
  { id: 'DEV-1250', title: 'Mobile bottom-sheet for quick actions',        stage: 'refined',status: 'busy', terminal: false, labels: ['feature','mobile'], viewers: ['lina'] },
  { id: 'DEV-1246', title: 'Email-change confirmation flow copy',          stage: 'final',  status: 'done', terminal: false, labels: ['copy'], viewers: ['sanne'] },
  { id: 'DEV-1248', title: 'Investigate flaky sync test',                  stage: 'unrefined', status: 'idle', terminal: false, labels: ['test','flaky'], viewers: [] },
  { id: 'DEV-1251', title: 'Cleanup: remove SESSION_STATE.md from root',   stage: 'unrefined', status: 'idle', terminal: false, labels: ['chore'], viewers: [] },
];

window.WS_AI_SUGGESTIONS = [
  { id: 1, title: "Merge overlapping work into a 'secrets' epic", body: "DEV-1241 (Microsoft SSO) and DEV-1249 (GitLab token vault) both touch credential storage. Group them under a shared epic?", tickets: ['DEV-1241','DEV-1249'] },
  { id: 2, title: 'Flaky test resembles a fixed issue', body: "DEV-1248 looks like the sync flake resolved in !72 last month. Want me to link them and re-run with the old fix?", tickets: ['DEV-1248'] },
];

window.WS_LABEL_COLORS = {
  bug:      { bg: 'rgba(229,72,77,.12)',  fg: 'var(--wrong)' },
  frontend: { bg: 'rgba(14,165,164,.13)', fg: 'var(--secondary)' },
  backend:  { bg: 'rgba(99,102,241,.13)', fg: '#6366F1' },
  feature:  { bg: 'rgba(59,130,246,.12)', fg: 'var(--primary)' },
  auth:     { bg: 'rgba(224,146,10,.13)', fg: 'var(--warning)' },
  security: { bg: 'rgba(229,72,77,.12)',  fg: 'var(--wrong)' },
  perf:     { bg: 'rgba(224,146,10,.13)', fg: 'var(--warning)' },
  mobile:   { bg: 'rgba(14,165,164,.13)', fg: 'var(--secondary)' },
  mcp:      { bg: 'rgba(99,102,241,.13)', fg: '#6366F1' },
  copy:     { bg: 'rgba(138,147,161,.15)',fg: 'var(--muted)' },
  test:     { bg: 'rgba(138,147,161,.15)',fg: 'var(--muted)' },
  flaky:    { bg: 'rgba(224,146,10,.13)', fg: 'var(--warning)' },
  chore:    { bg: 'rgba(138,147,161,.15)',fg: 'var(--muted)' },
};

window.WS_SPRINT = 'Sprint 24';

/* Per-ticket rich detail (overview, branch, files, links, stage history). */
window.WS_TICKET_DETAIL = {
  'DEV-1240': {
    branch: 'DEV-1240', mr: '!91 · draft', issue: '#1240',
    description: 'On slow (3G) connections the Avatar component briefly renders the colour-initials fallback before the image loads, then swaps to the image — a visible flicker. Cache the load/fail state per avatar identity so the first resolution fans out to every instance, and hold the previous frame during refetch.',
    carryOver: 'From Plan: keep the fallback identity key stable across `?v=` cache-busts; do not change the public Avatar API.',
    files: [
      { path: 'src/_components/Avatar.tsx', add: 12, del: 4 },
      { path: 'src/_providers/avatarProvider.tsx', add: 28, del: 2 },
      { path: 'src/_components/Avatar.test.tsx', add: 16, del: 0 },
    ],
    links: [{ id: 'DEV-1245', rel: 'relates to', ai: true }],
    history: [
      { stage: 'Refined', summary: 'Repro confirmed on throttled 3G; root-caused to per-instance state.', done: true },
      { stage: 'Plan', summary: 'Chose a shared AvatarProvider status map keyed by file id + cache-bust.', done: true },
      { stage: 'Implementatie', summary: 'In progress — provider wired, tests being written.', done: false },
    ],
  },
  'DEV-1241': {
    branch: 'DEV-1241', mr: '—', issue: '#1241',
    description: 'Add Microsoft (Entra ID) as an OAuth provider alongside GitLab/GitHub. Needs a decision on where the client secret lives per-workspace.',
    carryOver: 'From Refined: SSO must reuse the existing provider-button flow in LoginForm; no new auth surface.',
    files: [], links: [{ id: 'DEV-1249', rel: 'relates to', ai: true }],
    history: [{ stage: 'Refined', summary: 'Scoped to Entra ID only for v1.', done: true }, { stage: 'Plan', summary: 'Waiting on secret-storage decision.', done: false }],
    needsInput: 'Where should the Microsoft client secret live — the per-workspace token vault from DEV-1249, or env for now?',
  },
};

/* Live terminals (README §6). */
window.WS_TERMINALS = [
  { id: 'DEV-1240', stage: 'Implementatie', status: 'busy', proc: 'claude', cwd: '/app', exit: '—',
    lines: [
      { t: 'g', s: 'claude>', x: ' editing src/_components/Avatar.tsx' },
      { t: 'm', s: '●', x: ' Running tests…' },
      { t: 'r', s: '', x: '  2 failing  ·  Avatar.test.tsx' },
      { t: 't', s: '$', x: '', cursor: true },
    ] },
  { id: 'DEV-1245', stage: 'Implementatie', status: 'busy', proc: 'claude', cwd: '/app', exit: '—',
    tabs: ['server', 'client', 'claude'], activeTab: 'claude',
    lines: [
      { t: 'b', s: '▲ vite', x: ' ready on :5173 · HMR connected' },
      { t: 'g', s: 'claude>', x: ' wiring dnd-kit columns…' },
      { t: 'm', s: '', x: '  added Column type, sortable context' },
      { t: 't', s: '$', x: '', cursor: true },
    ] },
  { id: 'DEV-1242', stage: 'Review', status: 'busy', proc: 'claude', cwd: '/app', exit: '—',
    lines: [
      { t: 'g', s: 'claude>', x: ' reviewing token-bucket limiter' },
      { t: 'c', s: '?', x: ' Should burst size be configurable per route?', wait: true },
      { t: 't', s: '$', x: '', cursor: true },
    ] },
];

/* Event log (README §6, screen M). */
window.WS_EVENTS = [
  { time: '14:32', actor: 'ai',   ticket: 'DEV-1240', type: 'command', text: '`npm test` → 2 failing' },
  { time: '14:31', actor: 'ai',   ticket: 'DEV-1240', type: 'file',    text: 'edited src/_components/Avatar.tsx (+12 −4)' },
  { time: '14:30', actor: 'ai',   ticket: 'DEV-1245', type: 'message', text: 'Wiring dnd-kit columns; need a Column type…' },
  { time: '14:29', actor: 'sanne',ticket: 'DEV-1241', type: 'status',  text: '→ needs input' },
  { time: '14:27', actor: 'ai',   ticket: 'DEV-1242', type: 'message', text: 'Asked: configurable burst size per route?' },
  { time: '14:24', actor: 'ai',   ticket: 'DEV-1245', type: 'command', text: '`npm run client` → vite ready :5173' },
  { time: '14:21', actor: 'mathijs', ticket: 'DEV-1240', type: 'status', text: '→ busy · started terminal' },
  { time: '14:18', actor: 'mr',   ticket: 'DEV-1246', type: 'mr',      text: 'merged !88 into main (abc123)' },
  { time: '14:12', actor: 'ai',   ticket: 'DEV-1247', type: 'file',    text: 'created src/mcp/graphify/impact_of.ts (+86)' },
  { time: '14:05', actor: 'tom',  ticket: 'DEV-1249', type: 'comment', text: 'Left a note on the vault encryption scheme' },
];

/* Sources: context docs + skills/MCP (screen I). */
window.WS_DOCS = [
  { id: 'summary',     name: 'project-summary',  source: 'generated', updated: '2h ago',  note: 'frozen @ abc123' },
  { id: 'conventions', name: 'conventions',      source: 'git',       updated: '1d ago',  note: 'frozen @ abc123' },
  { id: 'glossary',    name: 'glossary',         source: 'git',       updated: '3d ago',  note: 'frozen @ abc123' },
  { id: 'dbschema',    name: 'db-schema',        source: 'generated', updated: '2h ago',  note: 'frozen @ abc123' },
  { id: 'authspec',    name: 'Auth redesign.md', source: 'uploaded',  updated: '5d ago',  note: 'spec' },
];
window.WS_SKILLS = [
  { id: 'rag',      name: 'RAG · semantic_search', type: 'frozen', status: '12.4k chunks @ abc123 · healthy', model: 'self-hosted nomic', on: true },
  { id: 'graphify', name: 'graphify · impact_of',  type: 'live',   status: '1.8k nodes', on: true },
  { id: 'symbol',   name: 'symbol-index',          type: 'frozen', status: 'lookup · @ abc123', on: true },
  { id: 'route',    name: 'route-index',           type: 'frozen', status: '142 routes', on: false },
  { id: 'git',      name: 'git-history',           type: 'live',   status: 'blame + log', on: true },
  { id: 'test',     name: 'test-runner',           type: 'live',   status: 'vitest', on: true },
  { id: 'deps',     name: 'deps-audit',            type: 'live',   status: 'osv scanner', on: false },
  { id: 'cross',    name: 'cross-ticket',          type: 'live',   status: 'links + dedupe', on: true },
];

/* Pipeline — full per-stage config (screen H). */
window.WS_PIPELINE = [
  { id: 'unrefined', name: 'Unrefined', ai: false, docs: [], skills: [], mongo: 'ro', redis: 'ro', visible: ['refined'] },
  { id: 'refined',   name: 'Refined',   ai: true,  docs: ['summary','glossary'], skills: ['rag','cross'], mongo: 'ro', redis: 'ro', visible: ['plan'] },
  { id: 'plan',      name: 'Plan',      ai: true,  docs: ['summary','dbschema'], skills: ['rag','graphify','symbol'], mongo: 'ro', redis: 'ro', visible: ['impl','test','review'] },
  { id: 'impl',      name: 'Implementatie', ai: true, docs: ['summary','conventions','dbschema'], skills: ['rag','graphify','symbol','git','test'], mongo: 'rw', redis: 'rw', visible: ['test','review'] },
  { id: 'test',      name: 'Test',      ai: true,  docs: ['conventions'], skills: ['test','git'], mongo: 'ro', redis: 'ro', visible: ['review'] },
  { id: 'review',    name: 'Review',    ai: true,  docs: ['conventions','glossary'], skills: ['git','deps','cross'], mongo: 'ro', redis: 'ro', visible: ['final'] },
  { id: 'final',     name: 'Final',     ai: true,  docs: [], skills: ['git'], mongo: 'ro', redis: 'ro', visible: [] },
];

/* Account sessions (screen K). */
window.WS_SESSIONS = [
  { id: 1, device: 'MacBook Pro · Chrome', loc: 'Amsterdam, NL', last: 'now', current: true },
  { id: 2, device: 'iPhone 15 · Safari',   loc: 'Amsterdam, NL', last: '2h ago', current: false },
];
window.WS_SSH_KEYS = [
  { id: 1, name: 'MacBook Pro', type: 'ed25519', fp: 'SHA256:9f3a…7c21', added: 'Mar 2025', last: 'today' },
];
window.WS_PENDING_INVITES = [
  { id: 1, email: 'joost@youcomm.nl', role: 'Member', sent: '2d ago' },
];

/* Notifications (center). type: needs-input | merge | ai | failure */
window.WS_NOTIFICATIONS = [
  { id: 1, type: 'needs-input', title: 'DEV-1241 needs your input', body: 'AI asks where the Microsoft client secret should live.', ticket: 'DEV-1241', time: '2m', read: false },
  { id: 2, type: 'failure',  title: 'Container failed to start', body: 'DEV-1244 — out of memory while installing deps.', ticket: 'DEV-1244', time: '14m', read: false },
  { id: 3, type: 'ai',       title: 'New Workspace-AI suggestion', body: "Merge DEV-1241 & DEV-1249 into a 'secrets' epic.", ticket: 'DEV-1249', time: '31m', read: false },
  { id: 4, type: 'merge',    title: 'MR !88 merged', body: 'DEV-1246 merged into main (abc123).', ticket: 'DEV-1246', time: '1h', read: true },
  { id: 5, type: 'ai',       title: 'Agent escalated to needs-input', body: 'DEV-1242 looked stuck (idle 8m) — paused for you.', ticket: 'DEV-1242', time: '2h', read: true },
];
window.WS_NOTIF_META = {
  'needs-input': { icon: 'circle-question', color: 'var(--warning)', bg: 'rgba(224,146,10,.13)' },
  merge:         { icon: 'code-merge',      color: 'var(--correct)', bg: 'rgba(22,163,74,.12)' },
  ai:            { icon: 'robot',           color: 'var(--primary)', bg: 'rgba(59,130,246,.12)' },
  failure:       { icon: 'triangle-exclamation', color: 'var(--wrong)', bg: 'rgba(229,72,77,.12)' },
};

/* Sprints (with dates). */
window.WS_SPRINTS = [
  { id: 's24', name: 'Sprint 24', start: 'May 27', end: 'Jun 9', active: true, count: 9, daysLeft: 5 },
  { id: 's23', name: 'Sprint 23', start: 'May 13', end: 'May 26', active: false, count: 11, daysLeft: 0 },
  { id: 'backlog', name: 'Backlog', start: null, end: null, active: false, count: 3, daysLeft: null },
];

/* Budget / usage. */
window.WS_BUDGET = { spent: 168.40, cap: 200, alertPct: 80, currency: '€' };
window.WS_USAGE_ROWS = [
  { ticket: 'DEV-1245', tin: '1.2M', tout: '184k', cost: 4.10, time: '38m' },
  { ticket: 'DEV-1242', tin: '880k', tout: '120k', cost: 2.74, time: '26m' },
  { ticket: 'DEV-1240', tin: '420k', tout: '64k',  cost: 1.18, time: '12m' },
  { ticket: 'DEV-1247', tin: '610k', tout: '92k',  cost: 1.86, time: '19m' },
  { ticket: 'DEV-1244', tin: '300k', tout: '40k',  cost: 0.82, time: '9m' },
];
window.WS_TICKET_COST = { 'DEV-1240': '€1.18 · 12m', 'DEV-1245': '€4.10 · 38m', 'DEV-1242': '€2.74 · 26m' };

/* Model / effort options (pipeline). */
window.WS_MODELS = [
  { id: 'haiku', label: 'Claude Haiku — fast & cheap' },
  { id: 'sonnet', label: 'Claude Sonnet — balanced' },
  { id: 'opus', label: 'Claude Opus — deepest' },
];
