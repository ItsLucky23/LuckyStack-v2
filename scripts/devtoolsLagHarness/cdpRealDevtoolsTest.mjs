// REAL-DevTools measurement: launches Chrome with --auto-open-devtools-for-tabs
// so the ACTUAL DevTools frontend attaches (source-map parsing, console
// retention, DOM mirroring — everything the CDP-only simulation cannot cover).
// Measures the stress page with fix active vs neutralized, and compares against
// a DevTools-closed baseline run.
//
// Usage: node cdpRealDevtoolsTest.mjs [pageUrl]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PAGE = process.argv[2] ?? 'http://localhost:5174/devtools-lag-test?backend=83&n=1500&hz=20';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let msgId = 0;
const pending = new Map();
let ws;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('ws error'));
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
async function evalInPage(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
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
  return {
    fps: Math.round((frames / sec) * 10) / 10,
    ticksPerSec: Math.round(((readTick() - tick0) / sec) * 10) / 10,
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

async function runScenario({ label, devtoolsOpen, neutralizeFix, port }) {
  const profile = path.join(os.tmpdir(), `ls-realdevtools-${port}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
  ];
  if (devtoolsOpen) args.push('--auto-open-devtools-for-tabs');
  args.push('about:blank');
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null);
      if (targets?.some(t => t.type === 'page')) break;
      await sleep(250);
    }
    await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    if (neutralizeFix) await send('Page.addScriptToEvaluateOnNewDocument', { source: NEUTRALIZE_JS });
    await send('Page.navigate', { url: PAGE });
    //? Give the real DevTools frontend time to attach, fetch + parse source
    //? maps over the whole dev module graph, and settle.
    await sleep(devtoolsOpen ? 12000 : 4000);
    const m = await evalInPage(MEASURE_JS);
    console.log(`--- ${label}`);
    console.log('    ' + JSON.stringify(m));
    return m;
  } finally {
    chrome.kill();
    await sleep(800);
  }
}

const results = [];
results.push(['DevTools DICHT,  fix AAN', await runScenario({ label: 'DevTools DICHT, fix AAN (baseline)', devtoolsOpen: false, neutralizeFix: false, port: 9341 })]);
results.push(['DevTools OPEN,   fix AAN', await runScenario({ label: 'ECHTE DevTools OPEN, fix AAN', devtoolsOpen: true, neutralizeFix: false, port: 9342 })]);
results.push(['DevTools OPEN,   fix UIT', await runScenario({ label: 'ECHTE DevTools OPEN, fix UIT (= oude situatie)', devtoolsOpen: true, neutralizeFix: true, port: 9343 })]);
results.push(['DevTools DICHT,  fix UIT', await runScenario({ label: 'DevTools DICHT, fix UIT', devtoolsOpen: false, neutralizeFix: true, port: 9344 })]);

console.log(`\n===== SUMMARY (echte DevTools-frontend; page: ${PAGE}) =====`);
for (const [label, m] of results) {
  console.log(`${label.padEnd(28)} fps=${String(m.fps).padStart(5)}  ticks/s=${String(m.ticksPerSec).padStart(5)}  longTasks=${String(m.longTasks).padStart(4)} (${String(m.longTaskMs).padStart(7)}ms)  createTask=${m.createTask}`);
}
