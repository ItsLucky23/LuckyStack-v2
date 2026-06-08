export const meta = {
  name: 'verify-login-flow',
  description: 'Adversarial multi-agent review of LuckyStack login/session token handling across cookie + sessionStorage modes and re-login-while-logged-in',
  phases: [
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
}

const CONTEXT = [
  'LuckyStack is a socket-first React 19 + raw Node/Socket.io framework. We are',
  'hardening the AUTH/LOGIN flow. The user has manually tested login ~10 times and',
  'it keeps breaking. GOAL: log in to ANY valid account, in BOTH token-storage',
  'modes, EVEN WHEN ALREADY LOGGED IN, with no spurious logout / bounce-to-/login /',
  'nulled session.',
  '',
  "TWO TOKEN-STORAGE MODES (config.ts sessionBasedToken):",
  '- false (default) => HttpOnly cookie. Token set via Set-Cookie; socket uses',
  '  withCredentials; CSRF token fetched from /csrf-token.',
  '- true => sessionStorage. Token returned in X-Session-Token response header,',
  '  client stores it in sessionStorage token key, sends it as X-Session-Based-Token',
  '  request header + socket handshake auth token.',
  '',
  'SCENARIO MATRIX per mode:',
  '  (a) fresh login (no existing session)',
  '  (b) credentials login while already logged in via credentials (same/other acct)',
  '  (c) credentials login while already logged in via OAuth',
  '  (d) OAuth login while already logged in',
  '  (e) register while logged in',
  '',
  'WHAT CHANGED THIS SESSION (verify correct + complete, hunt gaps):',
  '- packages/login/src/session.ts: saveSession(token,data,newUser?,{supersedeToken?})',
  '  EXCLUDES supersedeToken from single-session enforcement kick list.',
  '  deleteSession(token,{skipSocketLogout?}) deletes+untracks+hooks but emits NO',
  '  socket logout when skipSocketLogout is true.',
  '- packages/login/src/login.ts: loginWithCredentials/loginWithCredentialsCore +',
  '  loginCallback thread supersedeToken into saveSession.',
  '- packages/server/src/httpRoutes/authApiRoute.ts: passes {supersedeToken: token}',
  '  into login and deleteSession(token,{skipSocketLogout:true}) on success.',
  '- packages/server/src/httpRoutes/authCallbackRoute.ts: same for OAuth; redirect now',
  '  publicUrl+loginRedirectUrl.',
  '',
  'Pre-existing client logout handler: packages/create-luckystack-app/template/src/',
  '_sockets/socketInitializer.ts (~line 206): on socket logout it clearCsrfToken() +',
  'location.href=loginPageUrl. LoginForm credentials success does notify.success then',
  'setTimeout(1000) => location.href=loginRedirectUrl, storing X-Session-Token into',
  'sessionStorage when sessionBasedToken.',
  '',
  'You MUST Read the actual files before reporting. Ground every finding in real code',
  'with file:line. Report ONLY real defects/correctness gaps for the matrix above, not',
  'style. If a scenario is handled correctly, say so. Do not invent bugs.',
].join('\n')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          mode: { type: 'string', enum: ['cookie', 'sessionStorage', 'both', 'oauth'] },
          scenario: { type: 'string' },
          file: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'severity', 'mode', 'scenario', 'file', 'evidence', 'suggestedFix'],
      },
    },
  },
  required: ['dimension', 'summary', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    refinedFix: { type: 'string' },
  },
  required: ['isReal', 'confidence', 'reasoning', 'refinedFix'],
}

const DIMENSIONS = [
  {
    key: 'cookie-credentials',
    prompt: 'Review COOKIE-mode (sessionBasedToken=false) credentials login across matrix rows (a),(b),(c),(e). Trace: LoginForm.tsx fetch -> authApiRoute.ts (Set-Cookie, supersedeToken, deleteSession skipSocketLogout) -> session.ts saveSession enforcement -> client redirect + SessionProvider re-fetch (system/session) + socket reconnect with new cookie + CSRF token (clearCsrfToken/fetch). Confirm re-login while logged in does NOT emit a logout to the current browser and the new session IS established after redirect. Hunt races (setTimeout 1000 vs cookie set, socket room vs token).',
  },
  {
    key: 'sessionstorage-credentials',
    prompt: 'Review SESSIONSTORAGE-mode (sessionBasedToken=true) credentials login across matrix rows (a),(b),(c),(e). Trace token via X-Session-Token response header -> sessionStorage token -> X-Session-Based-Token request header + socket handshake auth token. Does re-login REPLACE the sessionStorage token before the socket reconnects? Is the OLD token socket prevented from receiving a logout (supersede/skipSocketLogout)? Check apiRequest.ts and socketInitializer.ts token read timing, and whether clearCsrfToken matters in this mode. Find any case where the new session is null after re-login.',
  },
  {
    key: 'oauth-both-modes',
    prompt: 'Review OAuth login matrix rows (a),(c),(d) in BOTH modes. Trace authApiRoute.ts (provider redirect) -> provider -> authCallbackRoute.ts (state, loginCallback, supersedeToken, deleteSession skipSocketLogout, redirect publicUrl+loginRedirectUrl, cookie vs ?token= for sessionBasedToken). Verify OAuth-while-logged-in does not kill the session and lands on loginRedirectUrl. Check the sessionBasedToken branch appends ?token= correctly and the client picks it up.',
  },
  {
    key: 'server-session-lifecycle',
    prompt: 'Audit server session correctness in packages/login/src/{session.ts,login.ts,logout.ts,sessionAdapter.ts}. Verify: (1) supersedeToken exclusion is correct and the superseded session is actually cleaned up (no orphaned active-token entries); (2) deleteSession skipSocketLogout still untracks + deletes + fires hooks; (3) single-session enforcement order vs the new supersede path cannot double-delete or leak; (4) CSRF token minting/rotation across re-login; (5) maxConcurrentPerUser / onConflict paths are not broken by supersede. Find any state where a valid login leaves the user with no usable session.',
  },
  {
    key: 'client-session-state',
    prompt: 'Audit the CLIENT session state machine in packages/create-luckystack-app/template/src/_providers/SessionProvider.tsx + src/_sockets/socketInitializer.ts + src/_sockets/apiRequest.ts. Focus on the socket logout handler (clearCsrfToken + location.href=loginPageUrl) and updateSession handler. After a re-login, does the client reliably end up with the NEW session in BOTH modes, or can a stale logout/updateSession from the old token still fire and null it? Is the full-page redirect the only thing that establishes the new session, and is that robust? Identify any spurious-logout path that survives the server-side supersede fix.',
  },
]

phase('Review')

const reviewed = await pipeline(
  DIMENSIONS,
  (d) => agent(CONTEXT + '\n\n=== YOUR DIMENSION: ' + d.key + ' ===\n' + d.prompt, {
    label: 'review:' + d.key,
    phase: 'Review',
    schema: FINDINGS_SCHEMA,
  }),
  async (review, d) => {
    if (!review || !Array.isArray(review.findings) || review.findings.length === 0) {
      return { dimension: d.key, summary: review ? review.summary : 'no result', confirmed: [] }
    }
    const verdicts = await parallel(review.findings.map((f) => async () => {
      const v = await agent(
        CONTEXT +
          '\n\nAdversarially VERIFY this claimed login defect. Read the cited file(s) and decide if it is REAL for the stated mode+scenario. Default to isReal=false unless the code clearly confirms it. If real, give a concrete refinedFix.' +
          '\n\nCLAIM: ' + f.title +
          '\nMODE: ' + f.mode +
          '\nSCENARIO: ' + f.scenario +
          '\nFILE: ' + f.file +
          '\nEVIDENCE: ' + f.evidence +
          '\nPROPOSED FIX: ' + f.suggestedFix,
        { label: 'verify:' + d.key + ':' + f.severity, phase: 'Verify', schema: VERDICT_SCHEMA },
      )
      return { ...f, dimension: d.key, verdict: v }
    }))
    return { dimension: d.key, summary: review.summary, confirmed: verdicts.filter(Boolean) }
  },
)

const allConfirmed = reviewed
  .filter(Boolean)
  .flatMap((r) => r.confirmed)
  .filter((f) => f.verdict && f.verdict.isReal)

phase('Synthesize')

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' },
    confirmedBugs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          mode: { type: 'string' },
          file: { type: 'string' },
          rootCause: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'mode', 'file', 'rootCause', 'fix'],
      },
    },
    matrixStatus: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string' },
          scenario: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'broken', 'uncertain'] },
          note: { type: 'string' },
        },
        required: ['mode', 'scenario', 'status', 'note'],
      },
    },
    recommendedOrder: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'confirmedBugs', 'matrixStatus', 'recommendedOrder'],
}

const dimSummaries = JSON.stringify(
  reviewed.filter(Boolean).map((r) => ({ dimension: r.dimension, summary: r.summary })),
  null,
  2,
)
const confirmedJson = JSON.stringify(
  allConfirmed.map((f) => ({
    title: f.title,
    severity: f.severity,
    mode: f.mode,
    scenario: f.scenario,
    file: f.file,
    reasoning: f.verdict.reasoning,
    refinedFix: f.verdict.refinedFix,
  })),
  null,
  2,
)

const synthesis = await agent(
  CONTEXT +
    '\n\nYou are the synthesis lead. Below are ADVERSARIALLY-CONFIRMED login findings (isReal=true) plus each dimension summary. Produce: (1) overall verdict on whether login works for the full mode x scenario matrix, (2) a deduped list of confirmed bugs with root cause + concrete fix, (3) a matrixStatus grid (cookie/sessionStorage/oauth x scenarios a-e) marking ok/broken/uncertain, (4) recommended fix order. Do not invent issues beyond the confirmed list, but mark matrix cells uncertain where coverage was thin.' +
    '\n\nDIMENSION SUMMARIES:\n' + dimSummaries +
    '\n\nCONFIRMED FINDINGS:\n' + confirmedJson,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return { confirmedCount: allConfirmed.length, synthesis }
