import {
  captureException,
  dispatchHook,
  getEmailSender,
  getLogger,
  tryCatch,
  type EmailMessage,
  type EmailResult,
} from '@luckystack/core';

import { getEmailConfig } from './emailConfig';

//? The single helper framework + project code calls. Handles missing-sender
//? policy, terminal logging, and Sentry reporting (no-ops if Sentry isn't
//? installed). Returns a typed result rather than throwing so callers can
//? branch without try/catch — matches the rest of the framework's patterns.
export const sendEmail = async (message: EmailMessage): Promise<EmailResult> => {
  const config = getEmailConfig();
  const sender = getEmailSender();

  if (!sender) {
    if (config.required) {
      throw new Error(
        '[email] sendEmail() called but no email sender is registered. Install @luckystack/email and call registerEmailSender(...) at boot, or set emailConfig.required = false (via registerEmailConfig) to make this a soft failure.',
      );
    }

    if (config.logging.errors) {
      getLogger().warn(`[email] no sender registered — dropping message`, { to: String(message.to), subject: message.subject });
    }

    return { ok: false, reason: 'no-sender' };
  }

  const messageWithFrom: EmailMessage = {
    ...message,
    from: message.from ?? config.from,
  };

  await dispatchHook('preEmailSend', {
    message: messageWithFrom,
    adapter: sender.name,
  });

  const [sendError, sendResult] = await tryCatch<EmailResult, undefined>(() => sender.send(messageWithFrom));
  const result: EmailResult = sendError
    ? { ok: false, reason: sendError.message || 'send-threw', cause: sendError }
    : (sendResult ?? { ok: false, reason: 'send-no-result' });

  await dispatchHook('postEmailSend', {
    message: messageWithFrom,
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
    to: message.to,
    subject: message.subject,
    reason: result.reason,
  });

  return result;
};
