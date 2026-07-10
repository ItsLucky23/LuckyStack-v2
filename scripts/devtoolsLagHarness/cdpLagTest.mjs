// DevTools-lag reproduction harness — no deps, Node >= 22 (global WebSocket + fetch).
// Launches Chrome with a remote-debugging port, logs into the app, then measures
// main-thread health in 4 cells:
//   {createTask fix active | fix neutralized} x {async-stack-tracking off | on (= DevTools open)}
// Async-stack-tracking is what Chrome DevTools enables the moment it opens
// (Debugger.enable + Debugger.setAsyncCallStackDepth), so cell "on" simulates an
// open DevTools deterministically, without the DevTools UI.
//
// Usage: node cdp-lag-test.mjs [appUrl]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APP = process.argv[2] ?? 'http://localhost:5174/login?backend=81';
const PLAYGROUND = 'http://localhost:5174/playground?backend=81';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'ls-devtools-lag-profile');

const EMAIL = 'devtools-lag@test.local';
const PASS = 'DevTools!Lag42x';

// ---------- tiny CDP client ----------
let msgId = 0;
const pending = new Map();
const eventHandlers = new Map();
let ws;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('ws error: ' + e.message));
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      if (data.id !== undefined && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        data.error ? rej(new Error(JSON.stringify(data.error))) : res(data.result);
      } else if (data.method && eventHandlers.has(data.method)) {
        eventHandlers.get(data.method)(data.params);
      }
    };
  });
}
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const on = (method, fn) => eventHandlers.set(method, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalInPage(expr, { awaitPromise = true } = {}) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result.value;
}

// ---------- measurement payloads (stringified, run in page) ----------
const MEASURE_JS = `(async () => {
  // 1) promise-churn microbench: async tracking taxes every promise link
  const t0 = performance.now();
  let p = Promise.resolve();
  for (let i = 0; i < 20000; i++) p = p.then(() => {});
  await p;
  const promiseChurnMs = performance.now() - t0;

  // 2) timer churn
  const t1 = performance.now();
  await new Promise((done) => {
    let n = 0;
    const step = () => { if (++n >= 500) return done(); setTimeout(step, 0); };
    step();
  });
  const timerChurnMs = performance.now() - t1;

  // 3) 5s pointermove storm with fps + longtask observation
  let longTasks = 0, longTaskMs = 0;
  const obs = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) { longTasks++; longTaskMs += e.duration; }
  });
  obs.observe({ entryTypes: ['longtask'] });
  const w = innerWidth, h = innerHeight;
  let frames = 0, i = 0;
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      frames++;
      if (performance.now() - start > 5000) return resolve();
      for (let k = 0; k < 4; k++) {
        i++;
        const x = (Math.sin(i / 30) * 0.4 + 0.5) * w;
        const y = (Math.cos(i / 23) * 0.4 + 0.5) * h;
        const el = document.elementFromPoint(x, y) || window;
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  obs.disconnect();
  const stormSec = (performance.now() - start) / 1000;
  return {
    promiseChurnMs: Math.round(promiseChurnMs * 10) / 10,
    timerChurnMs: Math.round(timerChurnMs * 10) / 10,
    fps: Math.round((frames / stormSec) * 10) / 10,
    longTasks, longTaskMs: Math.round(longTaskMs),
    domNodes: document.querySelectorAll('*').length,
    createTask: String(console.createTask).slice(0, 40),
  };
})()`;

const LOGIN_JS = `(async () => {
  if (location.pathname === '/playground') return 'already';
  const setNative = (el, value) => {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('input[type=email]')) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const email = document.querySelector('input[type=email]');
  const pass = document.querySelector('input[type=password]');
  if (!email) return 'no-form:' + location.pathname;
  setNative(email, ${JSON.stringify(EMAIL)});
  setNative(pass, ${JSON.stringify(PASS)});
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Log in').click();
  return 'submitted';
})()`;

// Neutralize the index.html fix so React sees the REAL console.createTask again.
const NEUTRALIZE_JS = `(() => {
  const orig = console.createTask ? console.createTask.bind(console) : undefined;
  if (!orig) return;
  Object.defineProperty(console, 'createTask', {
    configurable: false,
    get: () => orig,
    set: () => {},
  });
})()`;

async function waitForPlayground() {
  for (let i = 0; i < 60; i++) {
    const p = await evalInPage('location.pathname', { awaitPromise: false }).catch(() => null);
    if (p === '/playground') return true;
    await sleep(500);
  }
  return false;
}

async function measureCell(label, { asyncDepth }) {
  if (asyncDepth > 0) {
    await send('Debugger.enable');
    await send('Debugger.setAsyncCallStackDepth', { maxDepth: asyncDepth });
  } else {
    await send('Debugger.setAsyncCallStackDepth', { maxDepth: 0 }).catch(() => {});
    await send('Debugger.disable').catch(() => {});
  }
  await sleep(500);
  const m = await evalInPage(MEASURE_JS);
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(m, null, 2));
  return m;
}

async function runVariant(name, { neutralizeFix }) {
  console.log(`\n===== VARIANT: ${name} =====`);
  if (neutralizeFix) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: NEUTRALIZE_JS });
  }
  await send('Page.navigate', { url: APP });
  await sleep(2500);
  const loginResult = await evalInPage(LOGIN_JS);
  console.log('login:', loginResult);
  if (loginResult !== 'already') {
    await sleep(1500);
  }
  const ok = await waitForPlayground();
  if (!ok) {
    // maybe we landed on /playground via redirect race; try direct nav
    await send('Page.navigate', { url: PLAYGROUND });
    await sleep(2500);
    const ok2 = await waitForPlayground();
    if (!ok2) throw new Error('never reached /playground');
  }
  await sleep(2000); // let the page settle
  const off = await measureCell(`${name} | async-tracking OFF`, { asyncDepth: 0 });
  const onn = await measureCell(`${name} | async-tracking ON (DevTools-open simulation)`, { asyncDepth: 32 });
  return { off, on: onn };
}

// ---------- main ----------
fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1400,900',
  'about:blank',
], { stdio: 'ignore', detached: false });

try {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).catch(() => null);
    if (targets?.length) break;
    await sleep(250);
  }
  if (!targets?.length) throw new Error('chrome debug port never came up');
  const page = targets.find(t => t.type === 'page');
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');

  const withFix = await runVariant('FIX ACTIVE (createTask undefined)', { neutralizeFix: false });
  const noFix = await runVariant('FIX NEUTRALIZED (native createTask)', { neutralizeFix: true });

  console.log('\n===== SUMMARY =====');
  const row = (label, m) => console.log(
    `${label.padEnd(46)} fps=${String(m.fps).padStart(5)}  longTasks=${String(m.longTasks).padStart(3)} (${String(m.longTaskMs).padStart(6)}ms)  promiseChurn=${String(m.promiseChurnMs).padStart(8)}ms  timerChurn=${String(m.timerChurnMs).padStart(7)}ms`
  );
  row('fix ON,  tracking OFF', withFix.off);
  row('fix ON,  tracking ON', withFix.on);
  row('fix OFF, tracking OFF', noFix.off);
  row('fix OFF, tracking ON  <== oude situatie', noFix.on);
} finally {
  chrome.kill();
}
