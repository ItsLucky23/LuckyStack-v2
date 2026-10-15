//? @adr 0069
import { createHash } from 'node:crypto';

import { tryCatch, type EmailDeliveryOutcome, type EmailMessage, type EmailResult } from '@luckystack/core';

import { renderTokens, type TokenValues } from './renderTokens';
import { normalizeIdempotencyKey, sendEmail, type SendEmailInput } from './sendEmail';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * One fully prepared message (the `messages` form). Same shape as a
 * `sendEmail` input — raw or registered-template — but with a single `to`, so
 * every message has exactly one outcome. The batch owns `signal`.
 */
export type BatchMessage = DistributiveOmit<SendEmailInput, 'to' | 'signal'> & { to: string };

/** One recipient of the `{{token}}` form. */
export interface BatchRecipient {
  to: string;
  /** Replaces the shared subject for this recipient; tokens are rendered too. */
  subject?: string;
  /** Token values for this recipient. */
  values?: TokenValues;
  /** Sent to this recipient only, after the shared attachments. */
  attachments?: EmailMessage['attachments'];
  /** Overrides the key derived from the batch key. */
  idempotencyKey?: string;
}

interface BatchControls {
  /** Mails in flight at once. Default 2. */
  concurrency?: number;
  /** Upper bound on mails started per second. Default: no bound. */
  perSecond?: number;
  /** Stops the batch: mails not yet started end as `not-sent` / `send-aborted`. */
  signal?: AbortSignal;
  /**
   * Stable key for this logical batch. Each message gets a key derived from it,
   * its position and its address. Retry an interrupted batch with the same key
   * and the same list; only providers with native idempotency (Resend) then
   * skip the mails that already went out.
   */
  idempotencyKey?: string;
  /** Larger batches are refused without sending anything. Default 500. */
  maxMessages?: number;
}

/** Shared `{{token}}` content plus one entry per recipient. */
export interface TokenBatchInput extends BatchControls {
  subject: string;
  html: string;
  text?: string;
  recipients: readonly BatchRecipient[];
  from?: string;
  replyTo?: string;
  /** Copied on the FIRST recipient's mail only, so a copy address gets one mail. */
  cc?: string | string[];
  /** Copied on the FIRST recipient's mail only, so a copy address gets one mail. */
  bcc?: string | string[];
  /** Attached to every recipient's mail. */
  attachments?: EmailMessage['attachments'];
  headers?: EmailMessage['headers'];
  /** Named sender slot, as in `sendEmail`. */
  adapter?: string;
}

export interface MessagesBatchInput extends BatchControls {
  messages: readonly BatchMessage[];
}

export type SendEmailBatchInput = TokenBatchInput | MessagesBatchInput;

/** `sent` means the provider accepted the mail, not that it was delivered. */
export type BatchDeliveryOutcome = 'sent' | EmailDeliveryOutcome;

export interface BatchItemResult {
  /** Position in the input list. */
  index: number;
  to: string;
  ok: boolean;
  messageId?: string;
  reason?: string;
  deliveryOutcome: BatchDeliveryOutcome;
}

export interface BatchCounts {
  total: number;
  sent: number;
  notSent: number;
  unknown: number;
}

export type BatchRefusal = 'batch-too-large' | 'invalid-batch-options' | 'invalid-idempotency-key';

/**
 * `ok: true` means the batch ran, not that every mail was accepted: read
 * `counts` and `items`. `ok: false` means it was refused and nothing was sent.
 */
export type BatchResult =
  | { ok: true; items: BatchItemResult[]; counts: BatchCounts }
  | { ok: false; reason: BatchRefusal; items: BatchItemResult[]; counts: BatchCounts };

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_MESSAGES = 500;

const isTokenBatch = (input: SendEmailBatchInput): input is TokenBatchInput => 'recipients' in input;

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value >= 1;

const deriveKey = (batchKey: string, index: number, to: string): string =>
  createHash('sha256').update(`${batchKey}:${String(index)}:${to.trim().toLowerCase()}`).digest('hex');

const countItems = (items: readonly BatchItemResult[]): BatchCounts => ({
  total: items.length,
  sent: items.filter((item) => item.deliveryOutcome === 'sent').length,
  notSent: items.filter((item) => item.deliveryOutcome === 'not-sent').length,
  unknown: items.filter((item) => item.deliveryOutcome === 'unknown').length,
});

const notSent = (index: number, to: string, reason: string): BatchItemResult =>
  ({ index, to, ok: false, reason, deliveryOutcome: 'not-sent' });

//? A failure without an outcome is adapter-specific (e.g. a 5xx after the
//? provider may have accepted the mail), so it counts as unknown: claiming
//? not-sent there would invite a duplicate on retry.
const toItem = (index: number, to: string, error: Error | null, result: EmailResult | null): BatchItemResult => {
  if (error || !result) {
    const reason = error && error.message.length > 0 ? error.message : 'send-threw';
    return { index, to, ok: false, reason, deliveryOutcome: 'unknown' };
  }
  if (result.ok) return { index, to, ok: true, messageId: result.id, deliveryOutcome: 'sent' };
  return { index, to, ok: false, reason: result.reason, deliveryOutcome: result.deliveryOutcome ?? 'unknown' };
};

const buildTokenMessage = (input: TokenBatchInput, recipient: BatchRecipient, index: number): BatchMessage => {
  const values = recipient.values ?? {};
  const attachments = [...(input.attachments ?? []), ...(recipient.attachments ?? [])];
  return {
    to: recipient.to,
    subject: renderTokens(recipient.subject ?? input.subject, values, { escape: 'none' }),
    html: renderTokens(input.html, values),
    text: input.text === undefined ? undefined : renderTokens(input.text, values, { escape: 'none' }),
    from: input.from,
    replyTo: input.replyTo,
    cc: index === 0 ? input.cc : undefined,
    bcc: index === 0 ? input.bcc : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    headers: input.headers,
    adapter: input.adapter,
    idempotencyKey: recipient.idempotencyKey,
  };
};

const waitOrAbort = (ms: number, signal: AbortSignal | undefined): Promise<boolean> =>
  new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

//? Spaces mail starts evenly instead of in bursts, because providers count
//? requests per second regardless of how many are in flight. Resolves false
//? when the batch is aborted while waiting for a slot.
const createPacer = (perSecond: number | undefined, signal: AbortSignal | undefined) => {
  if (perSecond === undefined) return (): Promise<boolean> => Promise.resolve(!signal?.aborted);
  const interval = 1000 / perSecond;
  let nextSlot = 0;
  return (): Promise<boolean> => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + interval;
    return slot > now ? waitOrAbort(slot - now, signal) : Promise.resolve(!signal?.aborted);
  };
};

/**
 * Send many transactional mails, each through `sendEmail` (so hooks, header
 * sanitizing, timeout and logging apply per mail), and report one outcome per
 * message in input order. Never throws for a send failure; address checks,
 * de-duplication and consent stay with the project.
 */
export const sendEmailBatch = async (input: SendEmailBatchInput): Promise<BatchResult> => {
  const list: readonly { to: string }[] = isTokenBatch(input) ? input.recipients : input.messages;
  const refuse = (reason: BatchRefusal): BatchResult => {
    const items = list.map((entry, index) => notSent(index, entry.to, reason));
    return { ok: false, reason, items, counts: countItems(items) };
  };

  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const maxMessages = input.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const { perSecond, signal } = input;
  if (
    !isPositiveInteger(concurrency)
    || !isPositiveInteger(maxMessages)
    || (perSecond !== undefined && !(Number.isFinite(perSecond) && perSecond > 0))
  ) {
    return refuse('invalid-batch-options');
  }
  if (list.length > maxMessages) return refuse('batch-too-large');
  const batchKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (batchKey === null) return refuse('invalid-idempotency-key');

  const messageAt = (index: number): BatchMessage => {
    if (isTokenBatch(input)) {
      const recipient = input.recipients[index];
      if (recipient === undefined) throw new RangeError(`no recipient at ${String(index)}`);
      return buildTokenMessage(input, recipient, index);
    }
    const message = input.messages[index];
    if (message === undefined) throw new RangeError(`no message at ${String(index)}`);
    return message;
  };

  const sendOne = async (index: number): Promise<BatchItemResult> => {
    const message = messageAt(index);
    const idempotencyKey = message.idempotencyKey ?? (batchKey ? deriveKey(batchKey, index, message.to) : undefined);
    const [error, result] = await tryCatch(() => sendEmail({ ...message, signal, idempotencyKey }));
    return toItem(index, message.to, error, result);
  };

  const items: BatchItemResult[] = Array.from({ length: list.length });
  const pace = createPacer(perSecond, signal);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const index = next;
      next += 1;
      const mayStart = await pace();
      items[index] = mayStart ? await sendOne(index) : notSent(index, list[index]?.to ?? '', 'send-aborted');
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));

  return { ok: true, items, counts: countItems(items) };
};
