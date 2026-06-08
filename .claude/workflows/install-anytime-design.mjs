export const meta = {
  name: 'install-anytime-design',
  description: 'Research + design the "install any @luckystack package at any time with zero manual wiring" architecture',
  phases: [
    { title: 'Map' },
    { title: 'Synthesize' },
  ],
}

const CONTEXT = [
  'GOAL ("install-anything-anytime"): a LuckyStack consumer should be able to install',
  'just a BASE package set, then LATER run `npm i @luckystack/presence` (or login, or',
  'error-tracking, etc.), restart, and have it WORK with ZERO manual code wiring.',
  'Same for: turning Sentry/monitoring on later (set env, restart); adding an OAuth',
  'provider later (set its env, restart); installing @luckystack/login after scaffolding',
  'a no-auth app. The dial: install everything (Django-style) OR base-only and add à la',
  'carte (FastAPI-style). The user explicitly wants the PURE `npm i` path to auto-wire',
  'where possible — no editing config.ts / server.ts / overlay files.',
  '',
  'CURRENT STATE (verified this session): 0.2.0 made login/presence/sync OPTIONAL peers.',
  '@luckystack/core has a session-provider registry; login registers into it at import.',
  '@luckystack/server has capabilities.ts (createRequire.resolve guard + lazy getLogin/',
  'getPresence/getSync) and degrades (auth.disabled/sync.disabled). `bootstrapLuckyStack`',
  'auto-imports the consumer overlay folder `luckystack/<pkg>/*.ts` in topological order.',
  'The scaffold (create-luckystack-app) wires features via OVERLAY files + config.ts +',
  'server.ts edits + template pages. oauthProviders.ts already registers a provider only',
  'when its env vars are present.',
  '',
  'KEY TENSION to analyze: today "add a feature" = npm i + EDIT overlay/config/server +',
  '(for login) add PAGES (LoginForm, /login route). The goal is npm i + (maybe env) only.',
  'That means moving DEFAULT wiring from consumer overlay files INTO the packages',
  '(self-registration on import, auto-detected at boot), and deciding how consumer-facing',
  'UI/pages/routes (login form, oauth buttons, settings pages) arrive when you `npm i`',
  'a package vs. when the CLI scaffolds them.',
  '',
  'You MUST Read the actual code before reporting. Ground findings in file:line. This is a',
  'DESIGN/RESEARCH pass — do NOT edit code. Be concrete about what auto-wires today vs',
  'what requires manual consumer code, and what change would make pure-`npm i` work.',
].join('\n')

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    todayWiring: { type: 'string', description: 'exactly how this is wired today: package self-register vs consumer overlay file vs config.ts vs server.ts vs template pages — with file:line' },
    npmiAloneGives: { type: 'string', description: 'what `npm i <pkg>` ALONE (no code edits) currently gives you, and where it falls short' },
    gapsForZeroWiring: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gap: { type: 'string' },
          fix: { type: 'string', description: 'concrete change (which package/file) to make it auto-wire on presence+env' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['gap', 'fix', 'effort', 'risk'],
      },
    },
    uiOrPagesProblem: { type: 'string', description: 'does this feature need consumer-facing UI/pages/routes that npm-i cannot create? how should those arrive (package-shipped mountable default / CLI `luckystack add` generator / left to user)?' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'design forks only the user can decide' },
  },
  required: ['area', 'todayWiring', 'npmiAloneGives', 'gapsForZeroWiring', 'uiOrPagesProblem', 'openQuestions'],
}

const AREAS = [
  {
    key: 'bootstrap-mechanism',
    prompt: 'Map the boot/auto-wire mechanism. Read packages/server/src/{createServer.ts,verifyBootstrap.ts,capabilities.ts} + bootstrapLuckyStack (find it) + template/server/server.ts + how it auto-imports the `luckystack/<pkg>/` overlay. Answer: what makes a package wire itself at boot today? Could bootstrap AUTO-DETECT installed @luckystack/* packages (via require.resolve) and import each packages own default-wiring entry WITHOUT a consumer overlay file? What would each optional package need to EXPORT (e.g. a `register()` / side-effect entry) for presence-based auto-wiring? Define the cleanest "auto-detect installed packages + self-wire" design.',
  },
  {
    key: 'presence',
    prompt: 'Map @luckystack/presence wiring. Read packages/presence/src/* (registerPresenceHooks, index) + template/server/server.ts (where registerPresenceHooks is called) + template/src/main.tsx + TemplateProvider.tsx + config.ts flags. What does `npm i @luckystack/presence` alone give vs require manual wiring (server.ts registerPresenceHooks call, LocationProvider/SocketStatusIndicator in client, config flags)? What is needed so installing it later just works (server side auto-wire + client components conditionally mounted)?',
  },
  {
    key: 'sync',
    prompt: 'Map @luckystack/sync wiring. Read packages/sync/src/* + packages/server/src/loadSocket.ts (sync listener gating) + template/src/_sockets/{socketInitializer.ts,syncRequest.ts}. Note the coupling: initSyncRequest is called from the presence/activity path in socketInitializer.ts. What does npm i sync alone give? What client wiring (syncRequest.ts, socketInitializer sync handler) is consumer code that npm-i cannot add? How to make sync add-later work (server auto-wires via capabilities; client needs the sync transport file) — propose how the client side arrives without manual editing.',
  },
  {
    key: 'login-and-oauth',
    prompt: 'Map @luckystack/login + OAuth wiring. Read packages/login/src/{index.ts,oauthProviders.ts,userAdapter.ts} + template/luckystack/login/{oauthProviders.ts,userAdapter.ts} + template/config.ts (SessionLayout/AuthProps) + template/src/{login,register,reset-password,settings} + LoginForm.tsx + functions/session.ts. Critically address the user question: in the create-luckystack-app CLI you choose OAuth providers and it scaffolds pages + overlay; if instead you `npm i @luckystack/login` later, you get the package but NOT the pages/overlay/oauth selection. How should adding login later deliver: (a) session-provider auto-registration (already on import?), (b) auth routes (server auto-wires via capabilities?), (c) the consumer overlay (oauthProviders/userAdapter) — can these default inside the package?, (d) the UI pages (LoginForm, /login, /register, /settings) — package-shipped mountable defaults vs a `luckystack add login` generator?, (e) OAuth providers are env-detected already — confirm and state whether adding a provider later is truly just env+restart.',
  },
  {
    key: 'monitoring-and-email',
    prompt: 'Map @luckystack/error-tracking (sentry/datadog/posthog) + @luckystack/email wiring. Read packages/error-tracking/src/* + packages/email/src/* + template/server/server.ts (initializeSentry, registerSentryConfig, registerEmailSender, autoSelectEmailSender) + template/luckystack/sentry/* + the scaffold MONITORING_DEPS/injectOptionalDeps. The user wants: opt out of Sentry now, opt in later with no problem (set SENTRY_DSN, npm i, restart). What auto-wires today (autoSelectEmailSender env-detects; sentry?) vs needs server.ts edits + overlay? What change makes "install error-tracking + set SENTRY_DSN later = works" with zero code edits?',
  },
  {
    key: 'add-later-ux',
    prompt: 'Design the "add a feature after scaffolding" UX. Read create-luckystack-app/src/index.ts (pruneOptionalPackages, injectOptionalDeps, overlay/page copying) + docs/DESIGN_OPTIONAL_SERVER_PACKAGES.md. Compare two models: (A) PURE `npm i @luckystack/<pkg>` + env + restart, framework auto-detects & self-wires (no files created) — works for runtime/server but cannot create consumer PAGES/overlay; (B) a `npx luckystack add <feature>` CLI that installs the dep AND injects the needed overlay/pages/config (the inverse of pruneOptionalPackages, reusing the same template assets). Recommend where each model fits per feature (presence/sync/login/oauth/sentry). Define what a `luckystack add` command would do and what package-shipped defaults would let pure npm-i cover more.',
  },
]

phase('Map')

const findings = await parallel(AREAS.map((a) => () =>
  agent(CONTEXT + '\n\n=== YOUR AREA: ' + a.key + ' ===\n' + a.prompt, {
    label: 'map:' + a.key,
    phase: 'Map',
    schema: MAP_SCHEMA,
  }),
))

const valid = findings.filter(Boolean)

phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targetArchitecture: { type: 'string', description: 'the end-state design for install-anything-anytime: how boot auto-detects + self-wires installed packages; what packages must export; the role (if any) of overlay files + a `luckystack add` CLI; how UI/pages arrive' },
    basePackageSet: { type: 'array', items: { type: 'string' }, description: 'the recommended minimal BASE install (always required) vs the optional à-la-carte set' },
    perAreaPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          area: { type: 'string' },
          canBePureNpmI: { type: 'string', enum: ['yes', 'partly', 'no'] },
          plan: { type: 'string' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
        required: ['area', 'canBePureNpmI', 'plan', 'effort'],
      },
    },
    recommendedSequence: { type: 'array', items: { type: 'string' }, description: 'implementation order' },
    decisionsForUser: {
      type: 'array',
      description: 'the design forks the user must choose before implementation',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
        required: ['question', 'options', 'recommendation'],
      },
    },
  },
  required: ['targetArchitecture', 'basePackageSet', 'perAreaPlan', 'recommendedSequence', 'decisionsForUser'],
}

const synthesis = await agent(
  CONTEXT +
    '\n\nYou are the architecture lead. Below are per-area maps of how each feature is wired today + gaps for zero-wiring. Produce: (1) the target "install-anything-anytime" architecture, (2) the recommended BASE package set vs optional set, (3) a per-area plan with whether pure-`npm i` is achievable (yes/partly/no) + effort, (4) implementation sequence, (5) the concrete DESIGN DECISIONS the user must make (each with options + your recommendation). Be decisive and concrete; cite the mechanism (auto-detect+self-wire, package-shipped defaults, `luckystack add` CLI) per feature.' +
    '\n\nPER-AREA MAPS:\n' + JSON.stringify(valid, null, 2),
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return { areasMapped: valid.length, synthesis }
