//? A compact, ZERO-dependency multi-select (checkbox) prompt for the `manage`
//? command. Modeled on create-luckystack-app's arrow-key wizard but trimmed to a
//? SINGLE screen: ↑/↓ move · space toggle · enter confirm · ctrl-c aborts. Built
//? only on Node's `readline` keypress stream + ANSI escapes (no runtime deps).
//?
//? The pure diff/apply logic lives elsewhere (see commands/manage.ts) so the part
//? that can't be unit-tested (the raw TTY loop) stays minimal and isolated here.

import { emitKeypressEvents, createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

const ANSI = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  cyan: '[36m',
  green: '[32m',
} as const;

const ansiStyle = (text: string, ...styles: string[]): string => `${styles.join('')}${text}${ANSI.reset}`;

export interface CheckboxItem {
  /** Stable id returned in the selected set. */
  id: string;
  /** Primary label shown on the row. */
  label: string;
  /** One-line, dimmed explanation under the label. */
  description?: string;
  /** Whether the row starts checked. */
  checked: boolean;
}

interface KeyEvent {
  name?: string;
  ctrl?: boolean;
}

//? Result of a multi-select run. `aborted` is true when the user pressed ctrl-c
//? (the caller should treat it as "do nothing", not as an empty selection).
export interface CheckboxResult {
  selected: string[];
  aborted: boolean;
}

//? True when both stdin and stdout are interactive terminals — the prompt needs
//? raw-mode keypresses, so a piped / CI run must take the non-TTY guard instead.
export const isInteractive = (): boolean => input.isTTY && output.isTTY;

//? A simple line-mode y/N confirm (no raw keypress mode). Blank input returns the
//? default. Used to gate the manage plan before it touches the filesystem. The
//? caller guards `isInteractive()` first, so this never hangs in CI.
export const confirmPrompt = (question: string, defaultYes = false): Promise<boolean> =>
  new Promise((resolve) => {
    const rl = createInterface({ input, output });
    const hint = defaultYes ? 'Y/n' : 'y/N';
    rl.question(`${question} (${hint}) `, (raw) => {
      rl.close();
      const answer = raw.trim().toLowerCase();
      if (answer === '') resolve(defaultYes);
      else resolve(answer === 'y' || answer === 'yes');
    });
  });

//? Render a single multi-select screen and resolve with the chosen ids. The
//? caller MUST check `isInteractive()` first; on a non-TTY this would hang.
export const runCheckbox = (title: string, items: readonly CheckboxItem[]): Promise<CheckboxResult> =>
  new Promise((resolve) => {
    const checked = items.map((item) => item.checked);
    //? The baseline (what's installed NOW) so each row can show, live, what
    //? toggling it WILL DO relative to the current state — that's the "make it
    //? clear what's going to happen" the plain checkbox lacked.
    const initial = items.map((item) => item.checked);
    //? Cursor wraps over the items plus one trailing "Confirm" action row.
    const navCount = items.length + 1;
    let cursor = 0;
    let prevLines = 0;

    const pendingCounts = (): { add: number; remove: number } => {
      let add = 0;
      let remove = 0;
      for (const [i] of items.entries()) {
        if (checked[i] === initial[i]) continue;
        if (checked[i]) add += 1;
        else remove += 1;
      }
      return { add, remove };
    };

    //? Per-row state/action label: the pending change (ADD/REMOVE) when toggled
    //? away from its installed state, else the current state. Words, not just
    //? colour, so it's unambiguous.
    const stateTag = (i: number): string => {
      if (checked[i] !== initial[i]) {
        return checked[i] ? ansiStyle(' → will be ADDED', ANSI.green) : ansiStyle(' → will be REMOVED', ANSI.cyan, ANSI.bold);
      }
      return ansiStyle(initial[i] ? ' (installed)' : ' (not installed)', ANSI.dim);
    };

    const buildBlock = (): string => {
      const lines = ['', ansiStyle(title, ANSI.bold)];
      for (const [i, item] of items.entries()) {
        const active = i === cursor;
        const box = checked[i] === true ? ansiStyle('◉', ANSI.green) : '◯';
        const arrow = active ? ansiStyle('❯', ANSI.cyan) : ' ';
        const label = active ? ansiStyle(item.label, ANSI.cyan) : item.label;
        lines.push(`${arrow} ${box} ${label}${stateTag(i)}`);
        if (item.description !== undefined && item.description !== '') {
          lines.push(ansiStyle(`     ${item.description}`, ANSI.dim));
        }
      }
      const { add, remove } = pendingCounts();
      const confirmActive = cursor === items.length;
      const confirmArrow = confirmActive ? ansiStyle('❯', ANSI.cyan) : ' ';
      const summary = add === 0 && remove === 0 ? 'no changes yet' : `${String(add)} to add, ${String(remove)} to remove`;
      const confirmText = `Confirm (${summary})`;
      const confirmLabel = confirmActive ? ansiStyle(confirmText, ANSI.cyan, ANSI.bold) : ansiStyle(confirmText, ANSI.dim);
      lines.push(
        `${confirmArrow}   ${confirmLabel}`,
        ansiStyle('↑/↓ move · space or enter = toggle the row · go to Confirm + enter to apply · ctrl-c cancel', ANSI.dim),
      );
      return `${lines.join('\n')}\n`;
    };

    const paint = (): void => {
      if (prevLines > 0) output.write(`[${String(prevLines)}A[0J`);
      const block = buildBlock();
      output.write(block);
      prevLines = (block.match(/\n/g) ?? []).length;
    };

    const restoreTerminal = (): void => {
      input.off('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      output.write(`${ANSI.reset}[?25h`);
    };

    function onKey(str: string, key: KeyEvent): void {
      if (key.ctrl === true && key.name === 'c') {
        restoreTerminal();
        output.write('\n');
        resolve({ selected: [], aborted: true });
        return;
      }
      if (key.name === 'up') {
        cursor = (cursor - 1 + navCount) % navCount;
        paint();
        return;
      }
      if (key.name === 'down') {
        cursor = (cursor + 1) % navCount;
        paint();
        return;
      }
      const onConfirmRow = cursor === items.length;
      const spacePressed = key.name === 'space' || str === ' ';
      //? On an ITEM row, BOTH space and enter toggle it — pressing enter on a
      //? package now does the intuitive thing (select/deselect it) instead of
      //? immediately submitting. Submitting happens only from the Confirm row.
      if ((spacePressed || key.name === 'return') && !onConfirmRow) {
        checked[cursor] = !(checked[cursor] === true);
        paint();
        return;
      }
      if (key.name === 'return' && onConfirmRow) {
        restoreTerminal();
        const selected = items.filter((_, i) => checked[i] === true).map((item) => item.id);
        resolve({ selected, aborted: false });
      }
    }

    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    output.write('[?25l');
    input.on('keypress', onKey);
    paint();
  });
