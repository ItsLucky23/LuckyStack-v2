import type { EmailMessage } from '@luckystack/core';

//? Shared field-mapping for the SMTP + Resend adapters (E14). Both providers
//? accept the same `{ from, to, subject, html, text, replyTo, cc, bcc,
//? attachments, headers }` shape, so the projection lived duplicated in
//? `smtp.ts` and `resend.ts`. This is the single source of truth for that
//? mapping — byte-for-byte the object both adapters used to build inline.
//?
//? `from` is passed in already-resolved (message `from` ?? adapter default) by
//? the caller, because the missing-`from` guard returns an adapter-specific
//? `EmailResult` and must stay at each call site.
//?
//? `attachments` and `headers` are forwarded when present so the adapter
//? receives them (EMAIL-O2: they were silently dropped before).
export const toProviderPayload = (
  message: EmailMessage,
  fromAddress: string,
): Record<string, unknown> => ({
  from: fromAddress,
  to: message.to,
  subject: message.subject,
  html: message.html,
  text: message.text,
  replyTo: message.replyTo,
  cc: message.cc,
  bcc: message.bcc,
  ...(message.attachments !== undefined && { attachments: message.attachments }),
  ...(message.headers !== undefined && { headers: message.headers }),
});
