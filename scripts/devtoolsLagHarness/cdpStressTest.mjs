// DevTools-lag STRESS harness: measures the re-render storm page in 4 cells.
// node cdp-stress-test.mjs [pageUrl]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PAGE = process.argv[2] ?? 'http://localhost:5174/devtools-lag-test?backend=81&n=1500&hz=20';
const PORT = 9334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'ls-devtools-stress-profile');

let msgId = 0;
const pending = new Map();
let ws;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('ws error'));
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      if (data.id !== undefined && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        data.error ? rej(new Error(JSON.stringify(data.error))) : res(data.result);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalInPage(expr, { awaitPromise = true } = {}) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

const MEASURE_JS = `(async () => {
  const readTick = () => parseInt((document.querySelector('[data-testid=stats]')?.textContent.match(/tick=(\\d+)/) || [])[1] ?? '0', 10);
  let longTasks = 0, longTaskMs = 0;
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { longTasks++; longTaskMs += e.duration; } });
  obs.observe({ entryTypes: ['longtask'] });
  const tick0 = readTick();
  let frames = 0;
  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => { frames++; if (performance.now() - start > 5000) return resolve(); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  const sec = (performance.now() - start) / 1000;
  obs.disconnect();
  const tick1 = readTick();
  return {
    fps: Math.round((frames / sec) * 10) / 10,
    ticksPerSec: Math.round(((tick1 - tick0) / sec) * 10) / 10,
    longTasks, longTaskMs: Math.round(longTaskMs),
    domNodes: document.querySelectorAll('*').length,
    createTask: String(console.createTask).slice(0, 30),
  };
})()`;

const NEUTRALIZE_JS = `(() => {
  const orig = console.createTask ? console.createTask.bind(console) : undefined;
  if (!orig) return;
  Object.defineProperty(console, 'createTask', { configurable: false, get: () => orig, set: () => {} });
})()`;

//? mode 'off'   = geen instrumentatie
//? mode 'async' = alleen Debugger + async-stack-depth (de bewezen hoofdboosdoener)
//? mode 'full'  = alle domeinen die de echte DevTools-frontend bij openen enable't:
//?                DOM-mirror (getDocument), CSS, Overlay, Log, Network, Profiler + async-tracking.
async function setMode(mode) {
  if (mode === 'off') {
    await send('Debugger.setAsyncCallStackDepth', { maxDepth: 0 }).catch(() => {});
    for (const d of ['Debugger', 'DOM', 'CSS', 'Overlay', 'Log', 'Network', 'Profiler']) {
      await send(`${d}.disable`).catch(() => {});
    }
    return;
  }
  await send('Debugger.enable');
  await send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
  if (mode === 'full') {
    await send('DOM.enable').catch(() => {});
    await send('DOM.getDocument', { depth: -1, pierce: true }).catch(() => {});
    await send('CSS.enable').catch(() => {});
    await send('Overlay.enable').catch(() => {});
    await send('Log.enable').catch(() => {});
    await send('Network.enable').catch(() => {});
    await send('Profiler.enable').catch(() => {});
  }
}

async function measureCell(label, mode) {
  await setMode(mode);
  await sleep(700);
  const m = await evalInPage(MEASURE_JS);
  console.log(`--- ${label}`);
  console.log('    ' + JSON.stringify(m));
  return m;
}

async function runVariant(name, { neutralizeFix }) {
  console.log(`\n===== ${name} =====`);
  if (neutralizeFix) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEUTRALIZE_JS });
  await send('Page.navigate', { url: PAGE });
  await sleep(3500);
  const off = await measureCell('instrumentatie OFF', 'off');
  const asyncOnly = await measureCell('async-tracking ON', 'async');
  const full = await measureCell('FULL DevTools-domeinen ON', 'full');
  await setMode('off');
  return { off, async: asyncOnly, full };
}

fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1400,900',
  'about:blank',
], { stdio: 'ignore' });

try {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).catch(() => null);
    if (targets?.length) break;
    await sleep(250);
  }
  if (!targets?.length) throw new Error('chrome debug port never came up');
  await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');

  const withFix = await runVariant('FIX ACTIVE (createTask undefined)', { neutralizeFix: false });
  const noFix = await runVariant('FIX NEUTRALIZED (native createTask)', { neutralizeFix: true });

  console.log('\n===== SUMMARY (page: ' + PAGE + ') =====');
  const row = (label, m) => console.log(
    `${label.padEnd(42)} fps=${String(m.fps).padStart(5)}  ticks/s=${String(m.ticksPerSec).padStart(5)}  longTasks=${String(m.longTasks).padStart(4)} (${String(m.longTaskMs).padStart(7)}ms)`
  );
  row('fix ON,  instrumentatie OFF', withFix.off);
  row('fix ON,  async-tracking ON', withFix.async);
  row('fix ON,  FULL DevTools ON', withFix.full);
  row('fix OFF, instrumentatie OFF', noFix.off);
  row('fix OFF, async-tracking ON', noFix.async);
  row('fix OFF, FULL DevTools ON  <== oude situatie', noFix.full);
} finally {
  chrome.kill();
}
