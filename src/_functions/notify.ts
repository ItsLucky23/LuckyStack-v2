import { toast } from "sonner";
import { translate } from "src/_components/TranslationProvider";
import nlJson from "src/_locales/nl.json";
import enJson from "src/_locales/en.json";
import deJson from "src/_locales/de.json";
import frJson from "src/_locales/fr.json";
import { getCurrentSession } from "src/_providers/SessionProvider";
import { defaultLanguage } from "config";
import { registerNotifier } from "../../packages/core/src/notifier";

const Translator = () => {
  const session = getCurrentSession();
  const language = session?.language ?? defaultLanguage;

  switch (language) {
    case "nl": { return nlJson; }
    case "en": { return enJson; }
    case "de": { return deJson; }
    case "fr": { return frJson; }
    default: { return enJson; }
  }
}

const notify = {
  success: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    toast.success(translate({ translationList, key, params }));
  },
  error: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    toast.error(translate({ translationList, key, params }));
  },
  info: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    toast.info(translate({ translationList, key, params }));
  },
  warning: ({ key, params }: { key: string, params?: { key: string, value: string | number | boolean }[]}) => {
    const translationList = Translator();
    toast.warning(translate({ translationList, key, params }));
  },
}

//? Register with @luckystack/core so framework packages (apiRequest,
//? syncRequest) emit toasts through the project's i18n-backed notifier
//? instead of the no-op default. Side effect fires on any import of this
//? file — client bootstrap (main.tsx) already imports it transitively.
registerNotifier(notify);

export default notify;