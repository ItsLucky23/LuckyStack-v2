//? Client-side notifier DI. Framework packages (apiRequest, syncRequest,
//? offline queue flush) emit toasts on transport errors. Default is silent
//? (no-op) so tests and SSR contexts don't need a toaster installed.
//?
//? The project's entry point registers a notifier backed by its UI toolkit
//? (sonner + i18n) via `registerNotifier({ error, success, ... })`.

export interface NotifyParam {
  key: string;
  value: string | number | boolean;
}

export interface NotifyInput {
  key: string;
  params?: NotifyParam[];
}

export interface Notifier {
  success: (input: NotifyInput) => void;
  error: (input: NotifyInput) => void;
  info: (input: NotifyInput) => void;
  warning: (input: NotifyInput) => void;
}

const noopNotifier: Notifier = {
  success: () => { /* no-op */ },
  error: () => { /* no-op */ },
  info: () => { /* no-op */ },
  warning: () => { /* no-op */ },
};

let activeNotifier: Notifier = noopNotifier;

export const registerNotifier = (notifier: Notifier): void => {
  activeNotifier = notifier;
};

export const getNotifier = (): Notifier => activeNotifier;

//? Delegating wrapper matching the project's existing `notify` shape so the
//? switchover inside framework packages is a one-line import change.
export const notify: Notifier = {
  success: (input) => activeNotifier.success(input),
  error: (input) => activeNotifier.error(input),
  info: (input) => activeNotifier.info(input),
  warning: (input) => activeNotifier.warning(input),
};
