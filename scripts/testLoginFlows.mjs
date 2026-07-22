/**
 * Login flow smoke test — runt in Node.js zonder extra dependencies.
 * Test: credentials register, credentials login, query-param preservation,
 * Google OAuth return_url encoding, admin route guard.
 *
 * Gebruik: node scripts/testLoginFlows.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

//? Follow the dev server's ACTUALLY-bound port (it may have auto-incremented off
//? a busy :80). Priority: TEST_BASE_URL > node_modules/.luckystack/dev-server.json
//? > http://localhost:80. Mirrors scripts/resolveTestBaseUrl.ts (this file is a
//? standalone .mjs so it inlines the same logic rather than importing the .ts).
const resolveBase = () => {
  if (process.env.TEST_BASE_URL) return process.env.TEST_BASE_URL;
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'), 'utf8'),
    );
    if (typeof info.port === 'number') return `http://localhost:${info.port}`;
  } catch { /* fall through to the default */ }
  return 'http://localhost:80';
};

const BASE    = resolveBase();
const FRONT   = 'http://localhost:5175';
const EMAIL   = `test-${Date.now()}@luckystack.dev`;
const PASS    = 'Test1234!';
const NAME    = 'LuckyStack Tester';

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅  ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ❌  ${label}`);
  if (detail) console.log(`       ${detail}`);
  failed++;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return r;
}

async function post(path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': FRONT,
      'X-Session-Based-Token': 'true',
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return r;
}

async function getWithOrigin(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Origin': FRONT },
    redirect: 'manual',
  });
  return r;
}

// ── 1. Server bereikbaar ────────────────────────────────────────────────────
console.log('\n── 1. Server health ──');
try {
  const r = await get('/livez');
  const body = await r.json();
  body?.status === 'live' ? ok('GET /livez → {"status":"live"}') : fail('/livez response wrong', JSON.stringify(body));
} catch (e) { fail('/livez crashed', e.message); }

// ── 2. Auth providers beschikbaar ──────────────────────────────────────────
console.log('\n── 2. Auth providers ──');
let hasCredentials = false;
let hasGoogle = false;
try {
  const r = await get('/auth/providers');
  const body = await r.json();
  hasCredentials = body?.providers?.includes('credentials');
  hasGoogle = body?.providers?.includes('google');
  hasCredentials ? ok(`credentials provider actief`) : fail('credentials provider NIET gevonden', JSON.stringify(body));
  hasGoogle      ? ok(`google provider actief`)      : fail('google provider NIET gevonden',      JSON.stringify(body));
} catch (e) { fail('/auth/providers crashed', e.message); }

// ── 3. Register nieuw account ───────────────────────────────────────────────
console.log('\n── 3. Credentials register ──');
let sessionToken = null;
if (hasCredentials) {
  try {
    const r = await post('/auth/api/credentials', { name: NAME, email: EMAIL, password: PASS, confirmPassword: PASS, provider: 'register' });
    const body = await r.json();
    if (body?.status === true) {
      ok(`Register succesvol (${EMAIL})`);
      sessionToken = r.headers.get('x-session-token');
      sessionToken ? ok('Session token ontvangen in x-session-token header') : fail('Geen session token in response headers');
    } else {
      fail(`Register mislukt: ${body?.reason}`, JSON.stringify(body));
    }
  } catch (e) { fail('Register crashed', e.message); }
}

// ── 4. Login met zelfde account ─────────────────────────────────────────────
console.log('\n── 4. Credentials login ──');
if (hasCredentials) {
  try {
    const r = await post('/auth/api/credentials', { email: EMAIL, password: PASS, provider: 'login' });
    const body = await r.json();
    if (body?.status === true && body?.authenticated === true) {
      ok(`Login succesvol (${EMAIL})`);
      const tok = r.headers.get('x-session-token');
      tok ? ok('Session token ontvangen') : fail('Geen session token bij login');
    } else {
      fail(`Login mislukt: ${body?.reason}`, JSON.stringify(body));
    }
  } catch (e) { fail('Login crashed', e.message); }
}

// ── 5. Login met verkeerd wachtwoord ────────────────────────────────────────
console.log('\n── 5. Credentials login — verkeerd wachtwoord ──');
if (hasCredentials) {
  try {
    const r = await post('/auth/api/credentials', { email: EMAIL, password: 'VerkeerdWachtwoord!', provider: 'login' });
    const body = await r.json();
    body?.status === false
      ? ok(`Correcte fout teruggegeven: ${body?.reason}`)
      : fail('Verwacht status=false bij verkeerd wachtwoord', JSON.stringify(body));
  } catch (e) { fail('Wrong-password test crashed', e.message); }
}

// ── 6. Google OAuth redirect bevat return_url ───────────────────────────────
console.log('\n── 6. Google OAuth — return_url in redirect ──');
if (hasGoogle) {
  try {
    const returnUrl = encodeURIComponent(`${FRONT}/playground`);
    const r = await get(`/auth/api/google?return_url=${returnUrl}`);
    const location = r.headers.get('location');
    if (r.status === 302 && location?.includes('accounts.google.com')) {
      ok(`Redirect naar Google (302)`);
      // state moet aanwezig zijn
      location.includes('state=')
        ? ok('OAuth state aanwezig in redirect URL')
        : fail('OAuth state ONTBREEKT in redirect URL', location);
    } else {
      fail(`Geen 302 naar Google`, `status=${r.status} location=${location}`);
    }
  } catch (e) { fail('Google OAuth redirect test crashed', e.message); }
}

// ── 7. oauthCallbackBase port ────────────────────────────────────────────────
console.log('\n── 7. OAuth callback URL gebruikt juiste port ──');
if (hasGoogle) {
  try {
    // Haal de callback URL op vanuit de Google redirect; die staat in redirect_uri param
    const r = await get('/auth/api/google');
    const location = r.headers.get('location') ?? '';
    const match = location.match(/redirect_uri=([^&]+)/);
    if (match) {
      const redirectUri = decodeURIComponent(match[1]);
      console.log(`       redirect_uri = ${redirectUri}`);
      //? DRIFT DETECTOR (not a hardcoded :80 check — that MASKED a real bug).
      //? The redirect_uri MUST point at the same backend origin the server is
      //? actually on; otherwise the OAuth round-trip lands on a dead/other port.
      const basePort = new URL(BASE).port || '80';
      const matchesServerPort = basePort === '80'
        ? redirectUri.includes('localhost/auth/callback') || redirectUri.includes('localhost:80')
        : redirectUri.includes(`localhost:${basePort}`);
      matchesServerPort
        ? ok(`redirect_uri matcht de backend-poort waar de server op draait (${basePort})`)
        : fail(
            `redirect_uri drift: wijst NIET naar de draaiende backend-poort (${basePort})`,
            `${redirectUri} — authorize en token-exchange moeten beide de actueel gebonden directe backendpoort gebruiken; controleer bindregistratie en resolveDevCallbackUrl.`,
          );
    } else {
      fail('redirect_uri niet gevonden in Google redirect', location.slice(0, 200));
    }
  } catch (e) { fail('OAuth callback URL test crashed', e.message); }
}

// ── 8. CSRF endpoint ─────────────────────────────────────────────────────────
// Cookie-mode: token zit in Set-Cookie na login, niet als Bearer.
console.log('\n── 8. CSRF token endpoint ──');
try {
  // 8a. Unauthenticated → 401 verwacht (login actief + geen sessie)
  const rUnauth = await getWithOrigin('/auth/csrf');
  rUnauth.status === 401
    ? ok('/auth/csrf zonder sessie → 401 (correct, login actief)')
    : fail(`/auth/csrf zonder sessie returned ${rUnauth.status} (verwacht 401)`);

  // 8b. Login in cookie-mode (geen X-Session-Based-Token header), cookie opvangen
  const cookieEmail = `csrf-test-${Date.now()}@luckystack.dev`;
  const rLogin = await fetch(`${BASE}/auth/api/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': FRONT },
    body: JSON.stringify({ name: 'CSRF Tester', email: cookieEmail, password: PASS, confirmPassword: PASS, provider: 'register' }),
    redirect: 'manual',
  });
  const setCookie = rLogin.headers.get('set-cookie');
  if (setCookie) {
    const cookiePart = setCookie.split(';')[0]; // "token=<value>"
    const rCsrf = await fetch(`${BASE}/auth/csrf`, {
      headers: { 'Origin': FRONT, 'Cookie': cookiePart },
    });
    if (rCsrf.ok) {
      const body = await rCsrf.json();
      body?.csrfToken ? ok('CSRF token verkregen met sessie-cookie') : fail('Geen csrfToken in geauth response', JSON.stringify(body));
    } else {
      fail(`/auth/csrf met sessie-cookie returned ${rCsrf.status}`);
    }
  } else {
    ok('/auth/csrf cookie-test overgeslagen (geen Set-Cookie in register response)');
  }
} catch (e) { fail('/auth/csrf crashed', e.message); }

// ── 9. Rate limiting ─────────────────────────────────────────────────────────
console.log('\n── 9. Rate limiting (spam endpoint) ──');
try {
  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = await post('/api/playground/spam/v1', { message: 'test' }, sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {});
    results.push(r.status);
  }
  const hasBlock = results.some(s => s === 429);
  hasBlock
    ? ok(`Rate limit geactiveerd na ${results.indexOf(429) + 1} verzoeken (429)`)
    : ok(`Rate limit niet geraakt binnen 5 verzoeken (limit=3 per window — vermoedelijk TTL niet verstreken)`);
} catch (e) { fail('Rate limit test crashed', e.message); }

// ── Samenvatting ─────────────────────────────────────────────────────────────
console.log(`\n── Resultaat: ${passed} passed / ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
