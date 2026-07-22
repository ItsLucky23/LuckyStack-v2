//? Email-sender registry. Two registration modes:
//?
//?  1. `registerEmailSender(sender)` — single global sender (legacy, kept
//?     for backwards compatibility with consumers who haven't migrated to
//?     the multi-adapter shape).
//?  2. `registerEmailSenders({ default, transactional, marketing, ... })` —
//?     multiple named senders. Convention: framework code (login's
//?     password-reset, account flows) routes to the `'transactional'` slot
//?     when registered, otherwise falls back to `'default'` or the legacy
//?     single sender.
//?
//? Types live here (not in `@luckystack/email`) so framework packages can
//? type-check against them without depending on the email package — keeping
//? the email package optional.

/**
 * A single email attachment (email F2). Adapters (Resend, SMTP/Nodemailer, SES)
 * thread these into their provider payload. `content` is the raw bytes
 * (`Buffer`/`Uint8Array`) or a base64 string; provide a `path`/`href` instead
 * for adapters that fetch externally. Shapes are intentionally permissive so a
 * single attachment object works across providers — each adapter maps the
 * fields it supports.
 */
export interface EmailAttachment {
  /** File name shown to the recipient (e.g. `invoice.pdf`). */
  filename: string;
  /** Inline bytes or base64 string. Mutually exclusive with `path`/`href`. */
  content?: Buffer | Uint8Array | string;
  /**
   * Local file path the adapter reads (when it supports path-based sends).
   *
   * @security Trusted-input field — do NOT derive from client-supplied data
   * without validation. Framework-level path-traversal or safe-directory checks
   * are NOT applied automatically; callers must reject paths that escape the
   * intended directory (e.g. containing `..` or absolute paths outside a known
   * root) before passing them here.
   */
  path?: string;
  /**
   * Remote URL the adapter fetches (when it supports href-based sends).
   *
   * @security Trusted-input field — do NOT derive from client-supplied data
   * without validation. Only `https:` and `http:` URLs are safe for
   * framework-internal use; arbitrary schemes (e.g. `file:`, `data:`) may be
   * forwarded to nodemailer/Resend without restriction. Validate against an
   * allowlist before passing here.
   */
  href?: string;
  /** MIME type (e.g. `application/pdf`). Adapter may infer from `filename` if omitted. */
  contentType?: string;
  /** `Content-ID` for inline/embedded images referenced by `cid:` in the HTML. */
  cid?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /**
   * File attachments (email F2). Owned by core (not `@luckystack/email`) so the
   * type is the single source of truth across the framework and every adapter;
   * adapters thread these into their provider's attachment payload. Optional —
   * a message without attachments behaves exactly as before.
   */
  attachments?: EmailAttachment[];
  /**
   * Custom message headers (email F2) — e.g. `X-Entity-Ref-ID`,
   * `List-Unsubscribe`, idempotency keys. Adapters merge these over the headers
   * they set themselves (adapter-reserved headers win to avoid breaking
   * delivery). Optional.
   *
   * @security CR and LF characters in header keys or values enable SMTP header
   * injection. `sendEmail` strips `\r` and `\n` from every key and value before
   * passing them to the adapter (EMAIL-O7). Do NOT derive keys or values from
   * unsanitized client input.
   */
  headers?: Record<string, string>;
}

export type EmailDeliveryOutcome = 'not-sent' | 'unknown';

export type EmailResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: string;
      cause?: unknown;
      /**
       * `unknown` means the caller stopped waiting after dispatch began; retry
       * only with the same idempotency key. Omitted on legacy/provider failures
       * whose delivery semantics are adapter-specific.
       */
      deliveryOutcome?: EmailDeliveryOutcome;
    };

export interface EmailSendContext {
  /** Cooperative cancellation. Custom adapters should abort provider I/O when supported. */
  signal: AbortSignal;
  /** Stable caller-provided key reused across retries of the same logical email. */
  idempotencyKey?: string;
}

export interface EmailSender {
  /** Adapter identifier for logs + diagnostics ("console", "resend", "smtp", etc.). */
  name: string;
  /**
   * The optional context preserves source compatibility with pre-0.7 adapters.
   * New adapters should honor `signal` and provider-native idempotency where available.
   */
  send: (message: EmailMessage, context?: EmailSendContext) => Promise<EmailResult>;
}

/**
 * Registry keyed by adapter-slot name. Reserved slots used by the
 * framework:
 *
 *  - `'default'` — fallback when no specific slot matches.
 *  - `'transactional'` — login password-reset, account-confirmation,
 *    invoice-receipt, security-critical emails.
 *  - `'marketing'` — newsletters, announcements; consumers MAY route
 *    bulk sends here.
 *  - `'diagnostics'` — diagnostic-test endpoints (e.g. playground).
 *
 * Custom slot names ('billing', 'support', etc.) are allowed; consumers
 * resolve them explicitly via `sendEmail({ adapter: 'billing', ... })`.
 */
export type EmailSenderRegistry = Partial<Record<string, EmailSender>>;

let activeSender: EmailSender | null = null;
let registry: EmailSenderRegistry = {};

/**
 * Register a single global email sender. Kept for backwards compatibility.
 * For new code, prefer `registerEmailSenders({ ... })` which lets the
 * framework route transactional vs. marketing through different adapters.
 */
export const registerEmailSender = (sender: EmailSender): void => {
  activeSender = sender;
  //? Mirror into the registry so `getEmailSenderByName('default')` finds
  //? the legacy registration too. Consumers calling both APIs in the same
  //? boot get last-write-wins (multi-API call beats single, or vice versa,
  //? depending on order).
  registry = { ...registry, default: sender };
};

/**
 * Register multiple named email senders. Replaces the entire registry
 * (last-write-wins). Use this when your app routes different message
 * types through different adapters — e.g. Resend for marketing and SMTP
 * for transactional. The framework picks adapter slots by convention
 * (see `EmailSenderRegistry`); consumer code can pick explicitly via
 * `sendEmail({ adapter: 'foo', ... })`.
 */
export const registerEmailSenders = (senders: EmailSenderRegistry): void => {
  registry = { ...senders };
  if (senders.default) {
    activeSender = senders.default;
  }
};

/** Read the legacy single sender (or the `default` slot of the registry). */
export const getEmailSender = (): EmailSender | null => activeSender ?? registry.default ?? null;

/**
 * Read a specific named sender. Falls back to the legacy single sender
 * when the requested slot is absent. Returns null when neither exists.
 * Pass the convention-based slots (`'transactional'`, `'marketing'`,
 * `'diagnostics'`, `'default'`) or any custom slot you registered.
 */
export const getEmailSenderByName = (name: string): EmailSender | null => {
  if (registry[name]) return registry[name];
  if (name === 'default' && activeSender) return activeSender;
  return null;
};

/** Read every registered slot name. */
export const listEmailSenderNames = (): string[] => Object.keys(registry);

export const isEmailSenderRegistered = (): boolean =>
  activeSender !== null || Object.keys(registry).length > 0;
