import zlib from 'node:zlib';
import fs from 'node:fs';

const path = process.argv[2];
let buf = fs.readFileSync(path);
if (path.endsWith('.gz')) buf = zlib.gunzipSync(buf);
const data = JSON.parse(buf.toString('utf8'));
const events = data.traceEvents || data;

const byName = new Map();
for (const e of events) {
  const cur = byName.get(e.name) || { count: 0, dur: 0 };
  cur.count++;
  cur.dur += e.dur || 0;
  byName.set(e.name, cur);
}
const rows = [...byName.entries()].sort((a, b) => b[1].dur - a[1].dur);
console.log('=== top 25 by total dur (µs) ===');
for (const [name, { count, dur }] of rows.slice(0, 25)) {
  console.log(`${String(dur).padStart(10)}  ${String(count).padStart(7)}x  ${name}`);
}
console.log('\n=== AsyncTask / debugger events ===');
let found = false;
for (const [name, { count, dur }] of rows) {
  if (/async|debugger/i.test(name)) { console.log(`${String(dur).padStart(10)}  ${String(count).padStart(7)}x  ${name}`); found = true; }
}
if (!found) console.log('(none)');
console.log('\n=== top 15 by count ===');
const byCount = [...byName.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [name, { count, dur }] of byCount.slice(0, 15)) {
  console.log(`${String(count).padStart(7)}x  dur=${dur}  ${name}`);
}
console.log(`\ntotal events: ${events.length}`);
