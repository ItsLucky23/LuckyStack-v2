//? Side-effect `./register` entry for @luckystack/email. Auto-imported at boot
//? by @luckystack/server's `bootstrapLuckyStack` when this package is installed,
//? so transactional email wires itself with NO consumer code edit — `npm i
//? @luckystack/email` (+ `resend` for Resend / `nodemailer` for SMTP) + env +
//? restart is enough.
//?
//? Registers the auto-selected sender: Resend when RESEND_API_KEY is set, else
//? SMTP when SMTP_HOST is set, else a dev Console sender that logs mail to the
//? terminal. Once a sender is registered, `sendEmail(...)` delivers and the
//? framework forgot-password / email-change flows start sending (gated by
//? `config.auth.forgotPassword`).
//?
//? A consumer overlay (`luckystack/email/*.ts`) runs AFTER this import, so a
//? hand-written override (custom adapter, explicit `from`) still wins.

import { registerEmailSender } from '@luckystack/core';
import { autoSelectEmailSender } from './autoSelect';

registerEmailSender(autoSelectEmailSender());
