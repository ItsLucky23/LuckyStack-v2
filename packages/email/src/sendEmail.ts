import { createHash } from 'node:crypto';

import {
  captureException,
  dispatchHook,
  getEmailSender,
  getEmailSenderByName,
  getLogger,
  tryCatch,
  type EmailMessage,
  type EmailResult,
} from '@luckystack/core';

import { getEmailConfig } from './emailConfig';
import { getEmailTemplate } from './templates';

//? Recipient addresses + subjects are PII and must never reach the EXTERNAL
//? error tracker verbatim (a Sentry `beforeSend` strips cookies but not these
//? fields). The local server-log diagnostics keep the real values; only the
//? captured context is redacted. Addresses are SHA-256 hashed (truncated) so
//? the same recipient still correlates across error reports without exposing
//? the address itself; subjects are reduced to presence + length.
const hashRecipient = (address: string): string =>
  `sha256:${createHash('sha256').update(address.trim().toLowerCase()).digest('hex').slice(0, 16)}`;

const redactRecipients = (value: string | string[] | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).map((address) => hashRecipient(address));
};

const redactSubject = (subject: string): string => `redacted(len=${subject.length})`;

/**
 * Input to the multi-mode `sendEmail` helper.
 *
 * Raw message: pass `subject` + `html` (legacy shape).
 * Template-based: pass `template` + optional `data`; the registered template
 * resolves `subject` + `html` from `data`.
 *
 * `adapter` is optional. When supplied, the matching named sender is used.
 * When omitted, the framework picks by convention:
 *
 *   1. Login package & other internal callers passing
 *      `adapterHint: 'transactional'` route to `getEmailSenderByName('transactional')`.
 *   2. Falls back to `getEmailSenderByName('default')` then to the legacy
 *      single sender from `registerEmailSender(...)`.
 */
export type SendEmailInput =
  | (EmailMessage & { adapter?: string; template?: undefined; data?: undefined; adapterHint?: never })
  | {
      to: string | string[];
      template: string;
      data?: Record<string, unknown>;
      adapter?: string;
      /** Internal hint used by framework callers to nudge toward `'transactional'` etc. */
      adapterHint?: 'transactional' | 'marketing' | 'diagnostics' | 'default';
      from?: string;
      replyTo?: string;
      cc?: string | string[];
      bcc?: string | string[];
    };

const resolveSender = (input: SendEmailInput) => {
  if (input.adapter) {
    const named = getEmailSenderByName(input.adapter);
    if (named) return named;
    // Fall through to defaults if the requested slot is missing; better to
    // send via the fallback than drop the message entirely.
  }
  if ('adapterHint' in input && input.adapterHint) {
    const hinted = getEmailSenderByName(input.adapterHint);
    if (hinted) return hinted;
  }
  return getEmailSenderByName('default') ?? getEmailSender();
};

const isTemplateInput = (
  input: SendEmailInput,
): input is Extract<SendEmailInput, { template: string }> => 'template' in input && Boolean(input.template);

//? The single helper framework + project code calls. Handles missing-sender
//? policy, terminal logging, and Sentry reporting (no-ops if Sentry isn't
//? installed). Returns a typed result rather than throwing so callers can
//? branch without try/catch — matches the rest of the framework's patterns.
export const sendEmail = async (input: SendEmailInput): Promise<EmailResult> => {
  const config = getEmailConfig();
  const sender = resolveSender(input);

  if (!sender) {
    if (config.required) {
      throw new Error(
        '[email] sendEmail() called but no email sender is registered. Install @luckystack/email and call registerEmailSender(...) (or registerEmailSenders({...})) at boot, or set emailConfig.required = false (via registerEmailConfig) to make this a soft failure.',
      );
    }

    if (config.logging.errors) {
      getLogger().warn(`[email] no sender registered — dropping message`, { to: String(input.to) });
    }

    return { ok: false, reason: 'no-sender' };
  }

  let message: EmailMessage;
  if (isTemplateInput(input)) {
    const template = getEmailTemplate(input.template);
    if (!template) {
      if (config.logging.errors) {
        getLogger().warn(`[email] template '${input.template}' not registered`, { to: String(input.to) });
      }
      return { ok: false, reason: 'no-template' };
    }
    const data = input.data ?? {};
    const rendered = template.render(data);
    message = {
      to: input.to,
      subject: template.subject(data),
      html: rendered.html,
      text: rendered.text,
      from: input.from ?? config.from,
      replyTo: input.replyTo,
      cc: input.cc,
      bcc: input.bcc,
    };
  } else {
    message = {
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      from: input.from ?? config.from,
      replyTo: input.replyTo,
      cc: input.cc,
      bcc: input.bcc,
    };
  }

  await dispatchHook('preEmailSend', {
    message,
    adapter: sender.name,
  });

  const [sendError, sendResult] = await tryCatch<EmailResult, undefined>(() => sender.send(message));
  const result: EmailResult = sendError
    ? { ok: false, reason: sendError.message || 'send-threw', cause: sendError }
    : (sendResult ?? { ok: false, reason: 'send-no-result' });

  await dispatchHook('postEmailSend', {
    message,
    adapter: sender.name,
    ok: result.ok,
    messageId: result.ok ? result.id : undefined,
    reason: result.ok ? undefined : result.reason,
  });

  if (result.ok) {
    if (config.logging.sends) {
      getLogger().info(`[email:${sender.name}] sent`, { to: String(message.to), subject: message.subject, id: result.id });
    }
    return result;
  }

  if (config.logging.errors) {
    getLogger().warn(`[email:${sender.name}] FAILED`, { to: String(message.to), subject: message.subject, reason: result.reason });
  }

  captureException(result.cause ?? new Error(`Email send failed: ${result.reason}`), {
    fn: 'sendEmail',
    senderName: sender.name,
    to: redactRecipients(message.to),
    cc: redactRecipients(message.cc),
    bcc: redactRecipients(message.bcc),
    subject: redactSubject(message.subject),
    reason: result.reason,
  });

  return result;
};
