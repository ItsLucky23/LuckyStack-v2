//? `useTheme()` — framework-owned theme state hook. Default value comes
//? from `getProjectConfig().defaultTheme` (the union literal exported by
//? the consumer's `config.ts`). Toggling sets the `.dark` class on
//? `<html>`. Persistence (e.g. saving to `User.theme` via
//? `settings/updateUser`) is up to the consumer — the hook only owns
//? local state + DOM class.

import { useState, useCallback } from 'react';
import { getProjectConfig } from '../projectConfig';

export type Theme = 'light' | 'dark';

const applyDomClass = (theme: Theme): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
};

export const useTheme = () => {
  const initialTheme = (getProjectConfig().defaultTheme) ?? 'light';
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyDomClass(next);
  }, []);

  return { theme, setTheme };
};
