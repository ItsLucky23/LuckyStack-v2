import type { EmailDeliveryOutcome, EmailMessage } from '@luckystack/core';

export interface PreEmailSendPayload {
  /** Full message about to be sent (after `from` was filled in from config). */
  message: EmailMessage;
  /** Adapter name (`'console'` | `'resend'` | `'smtp'` | a consumer-registered name). */
  adapter: string;
}

export interface PostEmailSendPayload {
  /** Same `message` reference passed to the pre hook — for correlation. */
  message: EmailMessage;
  /** Adapter that handled the send. */
  adapter: string;
  /** Whether the send succeeded. Mirrors `EmailResult.ok`. */
  ok: boolean;
  /** Provider-assigned id when `ok === true`. */
  messageId?: string;
  /** Failure reason when `ok === false`. */
  reason?: string;
  /** `unknown` after timeout/abort once provider dispatch had begun. */
  deliveryOutcome?: EmailDeliveryOutcome;
}

declare module '@luckystack/core' {
  interface HookPayloads {
    preEmailSend: PreEmailSendPayload;
    postEmailSend: PostEmailSendPayload;
  }
}
