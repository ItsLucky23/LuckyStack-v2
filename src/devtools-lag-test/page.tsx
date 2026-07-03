// luckystack-allow i18n: dev-only diagnostic stress page, never user-facing
/* eslint-disable react/jsx-no-literals -- dev-only diagnostic stress page, never user-facing */
//? intent: dev-only stress page that re-renders a large JSX tree at a fixed rate, to reproduce and measure the DevTools-open lag (React 19 console.createTask per element).
import { useEffect, useMemo, useState } from 'react';

export const template = 'plain';

//? Tunable via query params: /devtools-lag-test?n=3000&hz=30
//? n  = number of tiles (each tile = ~6 JSX elements)
//? hz = full-tree re-renders per second
const readIntParam = (key: string, fallback: number): number => {
  const raw = new URLSearchParams(globalThis.location.search).get(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const Tile = ({ index, tick }: { index: number; tick: number }) => {
  const hue = (index * 7 + tick) % 360;
  return (
    <div className={`flex flex-col rounded border border-container1-border p-1`}>
      <span className={`text-xs text-muted`}>{`#${String(index)}`}</span>
      <span className={`text-xs text-common`}>{`t${String(tick)}`}</span>
      <div className={`h-1 w-full`} style={{ backgroundColor: `hsl(${String(hue)} 60% 50%)` }} />
    </div>
  );
};

export default function DevtoolsLagTest() {
  const n = useMemo(() => readIntParam('n', 1500), []);
  const hz = useMemo(() => readIntParam('hz', 20), []);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const handle = globalThis.setInterval(() => {
      setTick((t) => t + 1);
    }, Math.max(10, Math.round(1000 / hz)));
    return () => {
      globalThis.clearInterval(handle);
    };
  }, [running, hz]);

  const tiles = useMemo(() => Array.from({ length: n }, (_, i) => i), [n]);

  return (
    <div className={`flex h-svh w-full flex-col gap-2 overflow-hidden bg-background p-2`}>
      <div className={`flex items-center gap-3`}>
        <span className={`text-sm font-bold text-title`}>{`DevTools lag stress page`}</span>
        <span className={`text-xs text-muted`} data-testid={`stats`}>
          {`n=${String(n)} hz=${String(hz)} tick=${String(tick)}`}
        </span>
        <button
          className={`rounded bg-primary px-2 py-1 text-xs text-common-primary`}
          onClick={() => {
            setRunning((r) => !r);
          }}
        >
          {running ? `pause` : `resume`}
        </button>
      </div>
      <div className={`grid flex-1 grid-cols-[repeat(auto-fill,minmax(52px,1fr))] content-start gap-1 overflow-auto`}>
        {tiles.map((i) => (
          <Tile key={i} index={i} tick={tick} />
        ))}
      </div>
    </div>
  );
}
