//? One CPU budget for every parallel tool in the build: TS 7 (`tsc`), ESLint,
//? Vitest, tsup/esbuild and Vite all start one thread per core by default, so
//? running them side by side would ask for several times the machine. Callers
//? split this budget between the tools they run at once; the sum never
//? exceeds it.
//?
//? LUCKYSTACK_MAX_THREADS overrides the default (all available cores), e.g. on
//? a shared CI runner or a dev box that also runs other work.
import os from 'node:os';
import process from 'node:process';

export const getThreadBudget = () => {
  const raw = Number.parseInt(process.env.LUCKYSTACK_MAX_THREADS ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : os.availableParallelism();
};

//? Split `total` threads over concurrent tools in proportion to `weights`
//? (largest remainder). Every tool gets at least one thread, so with more tools
//? than threads the sum is the tool count, the smallest budget that can run them.
export const splitThreads = (total, weights) => {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (total * weight) / weightSum);
  const shares = exact.map((value) => Math.max(1, Math.floor(value)));
  let spare = total - shares.reduce((sum, share) => sum + share, 0);
  //? Raising a small share to the one-thread minimum can overshoot the budget
  //? (4 threads over weights 2/1/1/8 gave 1/1/1/2); take it back from the
  //? largest shares.
  while (spare < 0) {
    const largest = shares.indexOf(Math.max(...shares));
    if (shares[largest] <= 1) break;
    shares[largest] -= 1;
    spare += 1;
  }
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (spare <= 0) break;
    shares[index] += 1;
    spare -= 1;
  }
  return shares;
};

//? Environment that caps a child process to `threads`. Go tools (tsc 7, esbuild)
//? honour GOMAXPROCS, Rust tools (Vite's Rolldown, Tailwind's scanner,
//? Lightning CSS) honour RAYON_NUM_THREADS, and LuckyStack's own scripts and
//? configs read LUCKYSTACK_MAX_THREADS.
export const threadEnv = (threads) => ({
  ...process.env,
  LUCKYSTACK_MAX_THREADS: String(threads),
  GOMAXPROCS: String(threads),
  RAYON_NUM_THREADS: String(threads),
});
