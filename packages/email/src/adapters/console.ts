import type { EmailSender } from '@luckystack/core';

interface ConsoleSenderOptions {
  /** Optional default `from` if the message doesn't override it. */
  from?: string;
}

//? Dev-mode adapter — never sends a real email. Logs the rendered subject,
//? recipient list, and the plain-text body (or first 400 chars of HTML if
//? no text fallback). Returns a deterministic fake id.
export const ConsoleSender = (_options: ConsoleSenderOptions = {}): EmailSender => ({
  name: 'console',
  send: async (message) => {
    const recipients = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    const body = message.text ?? message.html.replaceAll(/<[^>]+>/g, '').trim().slice(0, 400);

    console.log(
      [
        '╭─ [email:console] ──────────────────────────',
        `│ from:    ${message.from ?? '(default)'}`,
        `│ to:      ${recipients}`,
        `│ subject: ${message.subject}`,
        '├──────────────────────────────────────',
        body.split('\n').map((line) => `│ ${line}`).join('\n'),
        '╰──────────────────────────────────────',
      ].join('\n'),
    );

    return { ok: true, id: `console-${String(Date.now())}` };
  },
});
