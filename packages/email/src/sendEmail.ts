import {
  captureException,
  getEmailSender,
  getProjectConfig,
  type EmailMessage,
  type EmailResult,
} from '@luckystack/core';

//? The single helper framework + project code calls. Handles missing-sender
//? policy, terminal logging, and Sentry reporting (no-ops if Sentry isn't
//? installed). Returns a typed result rather than throwing so callers can
//? branch without try/catch — matches the rest of the framework's patterns.
export const sendEmail = async (message: EmailMessage): Promise<EmailResult> => {
  const config = getProjectConfig().email;
  const sender = getEmailSender();

  if (!sender) {
    if (config.required) {
      throw new Error(
        '[email] sendEmail() called but no email sender is registered. Install @luckystack/email and call registerEmailSender(...) at boot, or set ProjectConfig.email.required = false to make this a soft failure.',
      );
    }

    if (config.logging.errors) {
      console.warn(`[email] no sender registered — dropping message to ${String(message.to)} ("${message.subject}")`);
    }

    return { ok: false, reason: 'no-sender' };
  }

  const messageWithFrom: EmailMessage = {
    ...message,
    from: message.from ?? config.from,
  };

  const result = await sender.send(messageWithFrom).catch((cause: unknown): EmailResult => ({
    ok: false,
    reason: cause instanceof Error ? cause.message : 'send-threw',
    cause,
  }));

  if (result.ok) {
    if (config.logging.sends) {
      console.log(`[email:${sender.name}] sent → ${String(message.to)} ("${message.subject}") id=${result.id}`);
    }
    return result;
  }

  if (config.logging.errors) {
    console.warn(`[email:${sender.name}] FAILED → ${String(message.to)} ("${message.subject}"): ${result.reason}`);
  }

  captureException(result.cause ?? new Error(`Email send failed: ${result.reason}`), {
    fn: 'sendEmail',
    senderName: sender.name,
    to: message.to,
    subject: message.subject,
    reason: result.reason,
  });

  return result;
};
