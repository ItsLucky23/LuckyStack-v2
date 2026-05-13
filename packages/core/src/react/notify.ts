//? Framework-owned i18n-backed toast notify. Reads the active language
//? source + the registered locales map to translate `{ key, params }`
//? before handing off to `sonner`. Registers itself with
//? `registerNotifier` on import so framework packages (apiRequest,
//? syncRequest) automatically emit toasts in the consumer's locale.
//?
//? Importing this module triggers the registration as a side effect —
//? add `import '@luckystack/core/client/notify';` to the consumer's
//? main entry once.

import { toast } from 'sonner';
import { registerNotifier } from '../notifier';
import { getActiveLanguage, getLocaleByCode } from '../localesRegistry';
import { translate, type TranslateParam } from './TranslationProvider';

interface NotifyInput {
  key: string;
  params?: TranslateParam[];
}

const resolve = (input: NotifyInput): string => {
  const language = getActiveLanguage();
  const list = getLocaleByCode(language);
  return translate({
    translationList: (list && typeof list === 'object' ? list : {}) as Record<string, unknown>,
    key: input.key,
    params: input.params,
  });
};

const notify = {
  success: (input: NotifyInput) => { toast.success(resolve(input)); },
  error: (input: NotifyInput) => { toast.error(resolve(input)); },
  info: (input: NotifyInput) => { toast.info(resolve(input)); },
  warning: (input: NotifyInput) => { toast.warning(resolve(input)); },
};

//? Side-effect: register with core so framework packages emit through
//? this i18n-backed implementation.
registerNotifier(notify);

export default notify;
