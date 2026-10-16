//? @adr 0070
import { createHash } from 'node:crypto';

import {
  captureException,
  tryCatchSync,
  type EmailAttachment,
  type EmailDeliveryOutcome,
  type EmailMessage,
  type EmailResult,
  type EmailSender,
} from '@luckystack/core';

import { getEmailConfig } from './emailConfig';
import { htmlToText } from './htmlToText';
import { renderTokens, type TokenValues } from './renderTokens';
import {
  normalizeIdempotencyKey,
  resolveSender,
  scrubEmailPii,
  sendEmailWith,
  settle,
  toTrackerCause,
  type SendEmailInput,
} from './sendEmail';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * One fully prepared message (the `messages` form). Same shape as a
 * `sendEmail` input — raw or registered-template — but with a single `to`, so
 * every message has exactly one outcome. The batch owns `signal`. An own
 * `idempotencyKey` must be unique per distinct mail (e.g.
 * `invoice-123:reminder-1`): Resend refuses a reused key with other content
 * for 24 hours.
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
  /**
   * Overrides the key derived from the batch key. Must be unique per distinct
   * mail, not per recipient: Resend refuses a reused key with other content
   * for 24 hours, so use e.g. `invoice-123:reminder-1`, not `invoice-123`.
   */
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
   * its address and its content, so reordering or removing recipients keeps
   * the other keys. Retry an interrupted batch with the same key; only
   * providers with native idempotency (Resend) then skip the mails that
   * already went out. Two identical mails to one address share a key.
   */
  idempotencyKey?: string;
  /** Larger batches are refused without sending anything. Default 500. */
  maxMessages?: number;
}

/** Shared `{{token}}` content plus one entry per recipient. */
export interface TokenBatchInput extends BatchControls {
  subject: string;
  html: string;
  /** Plain-text body with tokens. When omitted, one is generated from each rendered HTML body. */
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
  /**
   * Provider error code (e.g. `daily_quota_exceeded`). A mail skipped because
   * its sender was blocked earlier in the batch has reason `sender-blocked`
   * and the code that blocked the sender.
   */
  code?: string;
  /** Provider status: HTTP status for an API provider, SMTP reply code for SMTP. */
  status?: number;
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
//? Distinct failure reasons reported per batch; the rest are summed into one
//? extra event so a batch of varied provider errors still stays bounded.
const MAX_REPORTED_REASONS = 10;

interface FailureGroup {
  count: number;
  notSent: number;
  unknown: number;
  //? The first cause of the reason, made safe for the tracker.
  cause: Error | string | undefined;
}

//? One tracker event per failure reason instead of one per recipient: a batch
//? of 500 with a bad API key would otherwise send 500 identical events and use
//? up the tracker quota (ADR 0070). The server log keeps one redacted line per
//? mail. Reasons are scrubbed because adapter-returned text can echo an address.
const reportFailures = (groups: ReadonlyMap<string, FailureGroup>, total: number): void => {
  const entries = [...groups.entries()];
  for (const [reason, group] of entries.slice(0, MAX_REPORTED_REASONS)) {
    captureException(new Error(`[email] batch: ${reason} (${String(group.count)}×)`, { cause: group.cause }), {
      fn: 'sendEmailBatch',
      reason,
      count: group.count,
      notSent: group.notSent,
      unknown: group.unknown,
      total,
    });
  }
  const rest = entries.slice(MAX_REPORTED_REASONS);
  if (rest.length > 0) {
    const count = rest.reduce((sum, [, group]) => sum + group.count, 0);
    captureException(new Error(`[email] batch: ${String(rest.length)} more failure reasons (${String(count)}×)`), {
      fn: 'sendEmailBatch',
      reasons: rest.map(([reason]) => reason),
      count,
      total,
    });
  }
};

const isTokenBatch = (input: SendEmailBatchInput): input is TokenBatchInput => 'recipients' in input;

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value >= 1;

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

//? Code-unit order, not `localeCompare`: the key must not depend on the locale.
const compareKeys = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const MAP_TAG = '\u0000Map';
const SET_TAG = '\u0000Set';

//? JSON with object keys sorted at every level, so equal template data always
//? yields the same text. BigInt has no JSON form; it is written as a string.
//? Map and Set would encode as `{}`, so different data would share a key; they
//? become tagged lists sorted by their encoding, so insertion order does not
//? matter and an empty Map differs from `{}`.
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === 'bigint') return nested.toString();
    if (nested instanceof Map) return { [MAP_TAG]: sortByEncoding([...nested.entries()]) };
    if (nested instanceof Set) return { [SET_TAG]: sortByEncoding([...nested.values()]) };
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    if (Object.getPrototypeOf(nested) !== Object.prototype) return nested;
    return Object.fromEntries(Object.entries(nested).toSorted(([a], [b]) => compareKeys(a, b)));
  });

//? Wrapped in an array so `undefined` still encodes to a string.
const sortByEncoding = (values: unknown[]): unknown[] =>
  values
    .map((entry) => ({ entry, encoded: stableStringify([entry]) }))
    .toSorted((a, b) => compareKeys(a.encoded, b.encoded))
    .map(({ entry }) => entry);

const attachmentDigest = (attachment: EmailAttachment) => ({
  filename: attachment.filename,
  path: attachment.path,
  href: attachment.href,
  cid: attachment.cid,
  contentType: attachment.contentType,
  content: attachment.content === undefined ? undefined : sha256(attachment.content),
});

const normalizeAddress = (address: string): string => address.trim().toLowerCase();

const normalizeAddresses = (value: string | string[] | undefined): string | string[] | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.map((address) => normalizeAddress(address)) : normalizeAddress(value);
};

//? What makes this mail this mail: address plus everything the recipient
//? receives — content, sender, copies, headers and attachments. Position is
//? left out on purpose — a key tied to the position moves to another
//? recipient when the list is reordered or shortened (ADR 0070).
const messageFingerprint = (message: BatchMessage): string => {
  const content = 'template' in message && message.template !== undefined
    ? { template: message.template, data: message.data }
    : { subject: message.subject, html: message.html, text: message.text };
  return stableStringify({
    to: normalizeAddress(message.to),
    ...content,
    from: normalizeAddresses(message.from),
    replyTo: normalizeAddresses(message.replyTo),
    cc: normalizeAddresses(message.cc),
    bcc: normalizeAddresses(message.bcc),
    headers: message.headers,
    attachments: message.attachments?.map((attachment) => attachmentDigest(attachment)),
  });
};

const deriveKey = (batchKey: string, index: number, message: BatchMessage): string => {
  //? Template data that cannot be serialised (a cycle) falls back to the
  //? position, which is still stable for an unchanged list.
  const [error, fingerprint] = tryCatchSync(() => messageFingerprint(message));
  return sha256(`${batchKey}:${error || fingerprint === null ? `#${String(index)}:${message.to}` : fingerprint}`);
};

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
  return {
    index,
    to,
    ok: false,
    reason: result.reason,
    ...(result.code === undefined ? {} : { code: result.code }),
    ...(result.status === undefined ? {} : { status: result.status }),
    deliveryOutcome: result.deliveryOutcome ?? 'unknown',
  };
};

const buildTokenMessage = (input: TokenBatchInput, recipient: BatchRecipient, index: number): BatchMessage => {
  const values = recipient.values ?? {};
  const attachments = [...(input.attachments ?? []), ...(recipient.attachments ?? [])];
  const html = renderTokens(input.html, values);
  return {
    to: recipient.to,
    subject: renderTokens(recipient.subject ?? input.subject, values, { escape: 'none' }),
    html,
    text: input.text === undefined ? htmlToText(html) : renderTokens(input.text, values, { escape: 'none' }),
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

interface Waiter {
  skip: () => boolean;
  start: () => void;
}

//? Spaces mail starts evenly instead of in bursts, because providers count
//? requests per second regardless of how many are in flight. A slot goes to
//? the first waiting mail only once it is due, so a mail that stopped needing
//? one meanwhile (its sender got blocked, the batch was aborted) leaves the
//? queue without using it. `wait` also resolves for such a mail; the caller
//? checks which case it is.
const createPacer = (perSecond: number | undefined, signal: AbortSignal | undefined) => {
  if (perSecond === undefined) return { wait: (): Promise<void> => Promise.resolve(), close: (): void => { /* nothing held */ } };
  const interval = 1000 / perSecond;
  let nextSlot = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting: Waiter[] = [];
  const release = (): void => {
    clearTimeout(timer);
    timer = undefined;
    for (let head = waiting[0]; head !== undefined; head = waiting[0]) {
      const now = Date.now();
      if (!signal?.aborted && !head.skip()) {
        if (nextSlot > now) {
          timer = setTimeout(release, nextSlot - now);
          return;
        }
        nextSlot = now + interval;
      }
      waiting.shift();
      head.start();
    }
  };
  signal?.addEventListener('abort', release);
  return {
    wait: (skip: () => boolean): Promise<void> => new Promise((start) => {
      waiting.push({ skip, start });
      if (timer === undefined) release();
    }),
    close: (): void => { signal?.removeEventListener('abort', release); },
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

  const failures = new Map<string, FailureGroup>();
  const recordFailure = (reason: string, deliveryOutcome: BatchDeliveryOutcome | undefined, cause: unknown): void => {
    const key = scrubEmailPii(reason);
    const group = failures.get(key) ?? { count: 0, notSent: 0, unknown: 0, cause: toTrackerCause(cause) };
    group.count += 1;
    if (deliveryOutcome === 'not-sent') group.notSent += 1;
    if (deliveryOutcome === 'unknown') group.unknown += 1;
    failures.set(key, group);
  };

  //? Sender → the provider code that blocked it. Once a sender reports that it
  //? refuses all mail (quota used up, key rejected), the rest of its mails are
  //? skipped instead of each collecting the same refusal; mails routed to
  //? another sender carry on. Keyed by the sender object, not its name: two
  //? slots can wrap the same adapter with separate accounts.
  const blockedSenders = new Map<EmailSender, string>();
  const pacer = createPacer(perSecond, signal);

  const sendOne = async (index: number): Promise<BatchItemResult> => {
    const message = messageAt(index);
    const sender = resolveSender({ ...message, signal });
    if (!sender && getEmailConfig().required) {
      //? `sendEmail` throws here, but nothing was dispatched: a definite
      //? not-sent, reported once per batch like any other reason.
      const slot = message.adapter === undefined ? 'no email sender is registered' : `adapter slot '${message.adapter}' is not registered`;
      recordFailure('no-sender', 'not-sent', new Error(`[email] sendEmailBatch: ${slot}`));
      return notSent(index, message.to, 'no-sender');
    }
    const blocked = (): BatchItemResult | null => {
      const code = sender ? blockedSenders.get(sender) : undefined;
      return code === undefined ? null : { ...notSent(index, message.to, 'sender-blocked'), code };
    };
    //? Only a mail that will reach a provider waits for a pace slot. Blocking
    //? is checked before the wait and again after it: a sender blocked while
    //? the mail waited releases it without using a slot.
    if (sender) {
      const skipped = blocked();
      if (skipped) return skipped;
      await pacer.wait(() => blocked() !== null);
      if (signal?.aborted) return notSent(index, message.to, 'send-aborted');
      const skippedWhileWaiting = blocked();
      if (skippedWhileWaiting) return skippedWhileWaiting;
    }

    const idempotencyKey = message.idempotencyKey ?? (batchKey ? deriveKey(batchKey, index, message) : undefined);
    //? An object, not a `let`: the flag flips inside a callback, which control
    //? flow analysis cannot see.
    const state = { reported: false };
    const [error, result] = await settle(() => sendEmailWith({ ...message, signal, idempotencyKey }, {
      onFailure: (failure, failedSender) => {
        state.reported = true;
        recordFailure(failure.reason, failure.deliveryOutcome ?? 'unknown', failure.cause);
        if (failure.blocksSender === true && !blockedSenders.has(failedSender)) {
          blockedSenders.set(failedSender, failure.code ?? failure.reason);
        }
      },
      //? A throwing hook does not change the mail's outcome, so it counts as
      //? neither not-sent nor unknown; it is grouped like a failure reason.
      onHookError: (hook, hookError) => { recordFailure(`${hook} hook threw: ${hookError.message}`, undefined, hookError); },
    }));
    const item = toItem(index, message.to, error, result);
    //? A throw out of sendEmail never reached its reporting step; count it
    //? here so it is not silent.
    if (!state.reported && error) recordFailure(item.reason ?? 'send-threw', item.deliveryOutcome, error);
    return item;
  };

  const items: BatchItemResult[] = Array.from({ length: list.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const index = next;
      next += 1;
      items[index] = signal?.aborted ? notSent(index, list[index]?.to ?? '', 'send-aborted') : await sendOne(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()))
    .finally(() => { pacer.close(); });
  reportFailures(failures, list.length);

  return { ok: true, items, counts: countItems(items) };
};
