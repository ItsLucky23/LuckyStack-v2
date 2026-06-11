import { describe, it, expect } from 'vitest';

import { SmtpSender } from './smtp';

//? SmtpSender's factory runs a SYNCHRONOUS boot guard via
//?   loadPeer('nodemailer', ..., createRequire(import.meta.url))
//? which asserts the peer is installed before loading it. `nodemailer` is an
//? OPTIONAL peer and is NOT installed in this repo, so the guard throws a
//? descriptive error before any transporter is built. That is the only branch
//? we can deterministically cover here without installing the peer (a
//? `vi.mock('nodemailer')` cannot satisfy `require.resolve`, which hits the
//? real module resolver on disk).
//?
//? Intentionally NOT covered (requires the `nodemailer` peer to be installed):
//?   - happy-path transporter construction + send()
//?   - the createTransport-missing-export branch
//?   - the missing-from / sendMail-error result branches
//? These are exercised by the consumer integration suite where nodemailer is a
//? real dependency.

describe('SmtpSender (nodemailer not installed)', () => {
  it('throws a descriptive error pointing at the missing nodemailer peer', () => {
    expect(() => SmtpSender({ host: 'smtp.test', port: 587 })).toThrow(
      /`nodemailer` package is not installed/,
    );
  });

  it('mentions the remediation command in the thrown error', () => {
    expect(() => SmtpSender({ host: 'smtp.test', port: 587 })).toThrow(
      /npm install nodemailer/,
    );
  });
});
