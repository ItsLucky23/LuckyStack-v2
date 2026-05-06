//? Locale reloader registry. Lets `@luckystack/devkit`'s hot-reload watcher
//? trigger a translations reload without taking a relative-path dependency
//? on the consumer's project tree (the previous design did
//? `import { reloadLocaleTranslations } from "../../../server/utils/responseNormalizer"`,
//? which only resolved while devkit lived inside this monorepo).
//?
//? The consumer's `responseNormalizer.ts` (or whatever owns its translation
//? loading) calls `registerLocaleReloader(fn)` at boot. The watcher calls
//? `getLocaleReloader()?.()` whenever a `_locales/*.json` file changes. If
//? no reloader is registered, the watcher is a no-op for that event.

export type LocaleReloader = () => void | Promise<void>;

let activeReloader: LocaleReloader | null = null;

export const registerLocaleReloader = (reloader: LocaleReloader): LocaleReloader => {
  activeReloader = reloader;
  return reloader;
};

export const getLocaleReloader = (): LocaleReloader | null => activeReloader;
