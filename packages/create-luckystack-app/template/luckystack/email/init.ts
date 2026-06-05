//? Transactional email — enable-later, no code edit. Auto-loaded at boot by
//? bootstrapLuckyStack (the `email` overlay slot). When @luckystack/email is
//? installed it registers the auto-selected sender: Resend when RESEND_API_KEY
//? is set, else SMTP when SMTP_HOST is set, else a dev Console sender that logs
//? mail to the terminal. When the package isn't installed this is a silent
//? no-op, so email stays off until you opt in.
//?
//? Enable it later:
//?   1. npm i @luckystack/email          (+ `resend` for Resend, or `nodemailer` for SMTP)
//?   2. set the matching vars in `.env.local` (see the EMAIL section there)
//?   3. restart
//?
//? Once a sender is registered, `sendEmail(...)` delivers and the framework
//? forgot-password / email-change flows start sending (gated by
//? `config.auth.forgotPassword`).

import { tryCatch } from '@luckystack/core';

//? Optional peer — the specifier lives in a variable so the bundler/linter
//? doesn't treat the (possibly-absent) package as an unresolved static import.
const lazyEmail = (): Promise<{
  registerEmailSender: (sender: unknown) => void;
  autoSelectEmailSender: (options?: Record<string, unknown>) => unknown;
}> => {
  const emailModule = '@luckystack/email';
  return import(emailModule) as Promise<{
    registerEmailSender: (sender: unknown) => void;
    autoSelectEmailSender: (options?: Record<string, unknown>) => unknown;
  }>;
};

void (async () => {
  const [, email] = await tryCatch(lazyEmail);
  //? `email` is null when @luckystack/email isn't installed — email stays off.
  if (email) {
    email.registerEmailSender(email.autoSelectEmailSender());
  }
})();
