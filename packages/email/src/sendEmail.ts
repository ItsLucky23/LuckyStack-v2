import { createHash, createHmac } from 'node:crypto';

import {
  captureException,
  dispatchHook,
  getEmailSender,
  getEmailSenderByName,
  getLogger,
  tryCatch,
  tryCatchSync,
  type EmailMessage,
  type EmailResult,
} from '@luckystack/core';

import { getEmailConfig } from './emailConfig';
import { getEmailTemplate } from './templates';
import { getBuiltInEmailTemplate } from './builtInTemplates';

//? Recipient addresses + subjects are PII and must never reach the EXTERNAL
//? error tracker verbatim (a Sentry `beforeSend` strips cookies but not these
//? fields). The local server-log diagnostics keep the real values; only the
//? captured context is redacted.
//?
//? EMAIL-O5: a plain SHA-256 hash is an enumeration oracle — an attacker with
//? the hash can brute-force common addresses offline. We use HMAC-SHA-256 with
//? the configured `recipientHmacKey` when available. Without a key we fall back
//? to the un-keyed hash and emit a one-time dev warning so operators know to
//? configure the key. The `warned` flag is module-level so the warning fires
//? only once per process, not once per email.
let _warnedNoHmacKey = false;

const hashRecipient = (address: string): string => {
  const key = getEmailConfig().recipientHmacKey;
  const normalized = address.trim().toLowerCase();
  if (key !== undefined) {
    //? Empty string = opt-in un-keyed (consumer documented the tradeoff).
    if (key.length === 0) {
      return `sha256:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
    }
    return `hmac:${createHmac('sha256', key).update(normalized).digest('hex').slice(0, 16)}`;
  }
  //? No key configured: fall back to un-keyed hash + one-time dev warning.
  if (!_warnedNoHmacKey) {
    _warnedNoHmacKey = true;
    getLogger().warn(
      '[email] recipientHmacKey not configured — recipient hashes in error reports are SHA-256 without a key ' +
        '(enumeration oracle). Set emailConfig.recipientHmacKey to a secret string to harden this.',
    );
  }
  return `sha256:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
};

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
      attachments?: EmailMessage['attachments'];
      headers?: EmailMessage['headers'];
    };

//? EMAIL-O4: distinguish an EXPLICITLY-requested adapter from a best-effort
//? adapterHint. When the caller names a specific `adapter` slot and it is not
//? registered, we return `null` so the no-sender path logs a warning and
//? returns `{ ok: false, reason: 'no-sender' }`. Silently routing to a
//? different adapter (e.g. the default) would be a confused-deputy: security
//? mail (e.g. GDPR notifications) must go through the intended sender or fail.
const resolveSender = (input: SendEmailInput) => {
  if (input.adapter) {
    const named = getEmailSenderByName(input.adapter);
    if (named) return named;
    //? Explicit slot not registered — return null so the caller sees a
    //? clear no-sender failure rather than routing to an unintended adapter.
    return null;
  }
  if ('adapterHint' in input && input.adapterHint) {
    const hinted = getEmailSenderByName(input.adapterHint);
    if (hinted) return hinted;
  }
  return getEmailSenderByName('default') ?? getEmailSender();
};

//? EMAIL-O7: CR and LF characters in header-bound fields let an attacker
//? inject arbitrary SMTP headers (header injection). Strip them from every
//? field that ends up in an RFC 5322 header (to, from, subject, cc, bcc,
//? replyTo). The body (html / text) is NOT stripped here because it travels
//? in the message body, not headers, and stripping newlines there would break
//? content.
const stripCrlf = (value: string): string => value.replaceAll(/[\r\n]/g, '');
const stripCrlfAddress = (value: string | string[]): string | string[] =>
  Array.isArray(value) ? value.map((v) => stripCrlf(v)) : stripCrlf(value);

const sanitizeMessageHeaders = (message: EmailMessage): EmailMessage => ({
  ...message,
  to: stripCrlfAddress(message.to),
  from: message.from ? stripCrlf(message.from) : message.from,
  subject: stripCrlf(message.subject),
  replyTo: message.replyTo ? stripCrlf(message.replyTo) : message.replyTo,
  cc: message.cc === undefined ? message.cc : stripCrlfAddress(message.cc),
  bcc: message.bcc === undefined ? message.bcc : stripCrlfAddress(message.bcc),
  //? EMAIL-O7 extension: strip CR/LF from custom header keys AND values so an
  //? attacker-controlled header name or value can't inject arbitrary SMTP headers.
  headers: message.headers === undefined
    ? message.headers
    : Object.fromEntries(
        Object.entries(message.headers).map(([k, v]) => [stripCrlf(k), stripCrlf(v)]),
      ),
  //? EMAIL-O7 extension: strip CR/LF from each attachment's header-bound fields —
  //? `filename`/`contentType` render into a Content-Disposition/Content-Type MIME
  //? header and `cid` into a Content-ID header, so a `\r\n`-bearing value (e.g. a
  //? user-derived upload name or mime) could inject extra MIME headers at the
  //? nodemailer boundary the rest of this function defends against.
  attachments: message.attachments?.map((a) => ({
    ...a,
    filename: typeof a.filename === 'string' ? stripCrlf(a.filename) : a.filename,
    cid: typeof a.cid === 'string' ? stripCrlf(a.cid) : a.cid,
    contentType: typeof a.contentType === 'string' ? stripCrlf(a.contentType) : a.contentType,
  })),
});

const isTemplateInput = (
  input: SendEmailInput,
): input is Extract<SendEmailInput, { template: string }> => 'template' in input && Boolean(input.template);

type EmailConfigShape = ReturnType<typeof getEmailConfig>;

//? Resolved `EmailMessage` to send, OR a terminal `EmailResult` failure that
//? short-circuits the send (currently only `no-template`). Extracted from the
//? body of `sendEmail` (E13) — same branches, same effects, byte-for-byte.
type BuildMessageOutcome = { message: EmailMessage } | { failure: EmailResult };

//? Build the wire `EmailMessage` from either a template-based or raw input.
//? Mirrors the original inline branch exactly: the template branch resolves
//? consumer-override → built-in, logs + returns `no-template` on a miss, then
//? renders; the raw branch projects the scalar fields. No behavior change.
const buildMessage = (input: SendEmailInput, config: EmailConfigShape): BuildMessageOutcome => {
  if (isTemplateInput(input)) {
    //? Resolution order: consumer-registered template (last-write-wins
    //? override) → framework built-in (`password-reset` / `email-change`) →
    //? no-template. The built-in fallback is what makes the login flow's
    //? `registerEmailTemplate` override contract real (CFG-05 / QUA-067).
    const template = getEmailTemplate(input.template) ?? getBuiltInEmailTemplate(input.template);
    if (!template) {
      if (config.logging.errors) {
        getLogger().warn(`[email] template '${input.template}' not registered`, { to: redactRecipients(input.to) });
      }
      return { failure: { ok: false, reason: 'no-template' } };
    }
    const data = input.data ?? {};
    //? A consumer-registered template's `render` or `subject` can throw (e.g.
    //? missing required data field). Wrap so a buggy template surfaces as a
    //? typed failure instead of an unhandled exception (EMAIL-N3).
    const [renderError, rendered] = tryCatchSync(() => template.render(data));
    if (renderError || !rendered) {
      if (config.logging.errors) {
        getLogger().warn(`[email] template '${input.template}' render threw`, { error: renderError?.message ?? 'unknown' });
      }
      return { failure: { ok: false, reason: 'template-render-failed' } };
    }
    const [subjectError, resolvedSubject] = tryCatchSync(() => template.subject(data));
    if (subjectError || typeof resolvedSubject !== 'string') {
      if (config.logging.errors) {
        getLogger().warn(`[email] template '${input.template}' subject threw`, { error: subjectError?.message ?? 'unknown' });
      }
      return { failure: { ok: false, reason: 'template-render-failed' } };
    }
    return {
      message: {
        to: input.to,
        subject: resolvedSubject,
        html: rendered.html,
        text: rendered.text,
        from: input.from ?? config.from,
        replyTo: input.replyTo,
        cc: input.cc,
        bcc: input.bcc,
        attachments: input.attachments,
        headers: input.headers,
      },
    };
  }
  return {
    message: {
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      from: input.from ?? config.from,
      replyTo: input.replyTo,
      cc: input.cc,
      bcc: input.bcc,
    },
  };
};

//? Normalize the `sender.send` tuple into an `EmailResult`. Mirrors the inline
//? mapping exactly: a thrown error → `send-threw` (or its message); a
//? null/undefined result → `send-no-result`; otherwise the adapter's result.
const normalizeSendResult = (sendError: Error | null, sendResult: EmailResult | null): EmailResult =>
  sendError
    ? { ok: false, reason: sendError.message || 'send-threw', cause: sendError }
    : (sendResult ?? { ok: false, reason: 'send-no-result' });

//? Terminal logging + Sentry capture for a completed send. Mirrors the inline
//? tail exactly: success logs an info line (when enabled); failure logs a
//? redacted warning (when enabled) and always captures with PII redacted.
//? Recipients and subjects are redacted in log output (EMAIL-O6) — PII must
//? not reach the server log in plain text. The Sentry capture path already
//? applied redaction; the logger path was missing it.
const reportSendOutcome = (senderName: string, message: EmailMessage, result: EmailResult, config: EmailConfigShape): void => {
  if (result.ok) {
    if (config.logging.sends) {
      getLogger().info(`[email:${senderName}] sent`, { to: redactRecipients(message.to), subject: redactSubject(message.subject), id: result.id });
    }
    return;
  }

  if (config.logging.errors) {
    getLogger().warn(`[email:${senderName}] FAILED`, { to: redactRecipients(message.to), subject: redactSubject(message.subject), reason: result.reason });
  }

  captureException(result.cause ?? new Error(`Email send failed: ${result.reason}`), {
    fn: 'sendEmail',
    senderName,
    to: redactRecipients(message.to),
    cc: redactRecipients(message.cc),
    bcc: redactRecipients(message.bcc),
    subject: redactSubject(message.subject),
    reason: result.reason,
  });
};

//? The single helper framework + project code calls. Handles missing-sender
//? policy, terminal logging, and Sentry reporting (no-ops if Sentry isn't
//? installed). Returns a typed result rather than throwing so callers can
//? branch without try/catch — matches the rest of the framework's patterns.
//?
//? Thin orchestrator over `buildMessage` → `preEmailSend` hook →
//? `sender.send` (normalized via `normalizeSendResult`) → `postEmailSend` hook
//? → `reportSendOutcome` (E13 decomposition — same effects, same order).
export const sendEmail = async (input: SendEmailInput): Promise<EmailResult> => {
  const config = getEmailConfig();
  const sender = resolveSender(input);

  if (!sender) {
    if (config.required) {
      const detail = input.adapter
        ? `adapter slot '${input.adapter}' is not registered`
        : 'no email sender is registered. Install @luckystack/email and call registerEmailSender(...) (or registerEmailSenders({...})) at boot, or set emailConfig.required = false (via registerEmailConfig) to make this a soft failure';
      throw new Error(`[email] sendEmail() called but ${detail}.`);
    }

    if (config.logging.errors) {
      if (input.adapter) {
        //? EMAIL-O4: explicit adapter slot requested but not registered.
        //? Warn clearly so operators know the message was dropped, not silently
        //? rerouted to an unintended adapter.
        getLogger().warn(`[email] adapter slot '${input.adapter}' not registered — dropping message`, { to: redactRecipients(input.to) });
      } else {
        getLogger().warn(`[email] no sender registered — dropping message`, { to: redactRecipients(input.to) });
      }
    }

    return { ok: false, reason: 'no-sender' };
  }

  const built = buildMessage(input, config);
  if ('failure' in built) return built.failure;
  //? Apply CRLF sanitization before any hook or adapter sees the message
  //? (EMAIL-O7). Hooks observe the sanitized values so their payloads are
  //? also safe for logging.
  const message = sanitizeMessageHeaders(built.message);

  //? Honor the `preEmailSend` veto: a registered suppression hook (GDPR
  //? opt-out / unsubscribe / bounce list) returns a stop signal to abort the
  //? send. Short-circuit BEFORE `sender.send` so suppressed recipients never
  //? receive mail, and skip the `postEmailSend` "send attempt" hook +
  //? `reportSendOutcome` (no send was attempted). No hook registered ->
  //? `stopped` is false -> behavior unchanged.
  const preSend = await dispatchHook('preEmailSend', {
    message,
    adapter: sender.name,
  });
  if (preSend.stopped) {
    return { ok: false, reason: preSend.signal.errorCode || 'email.suppressed' };
  }

  //? EMAIL-O8: wrap the adapter send in a configurable timeout so a hung
  //? SMTP/Resend call does not pin the request indefinitely. The race is
  //? set up only when `sendTimeoutMs` is a positive number; `false` disables
  //? it entirely (documented escape hatch for long-running adapters).
  const sendWithTimeout = (): Promise<EmailResult> => {
    const sendPromise = sender.send(message);
    const { sendTimeoutMs } = config;
    if (sendTimeoutMs === false || sendTimeoutMs <= 0) return sendPromise;
    return new Promise<EmailResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, reason: 'send-timeout' });
      }, sendTimeoutMs);
      void sendPromise.then(
        (result) => { clearTimeout(timer); resolve(result); },
        (error: unknown) => {
          clearTimeout(timer);
          //? Rejection surfaces via the outer tryCatch wrapper below.
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  };

  const [sendError, sendResult] = await tryCatch<EmailResult, undefined>(sendWithTimeout);
  const result = normalizeSendResult(sendError, sendResult);

  await dispatchHook('postEmailSend', {
    message,
    adapter: sender.name,
    ok: result.ok,
    messageId: result.ok ? result.id : undefined,
    reason: result.ok ? undefined : result.reason,
  });

  reportSendOutcome(sender.name, message, result, config);

  return result;
};
