import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { EmailMessage } from '@luckystack/core';

import { ConsoleSender } from './console';

//? ConsoleSender never sends real mail; it logs to the terminal and returns a
//? deterministic fake id. We spy on `console.log` so the test asserts what the
//? adapter writes without spamming the test output, then restore it.

const baseMessage: EmailMessage = {
  to: 'user@test.dev',
  subject: 'Welcome',
  html: '<p>Hi <b>there</b></p>',
  text: 'Hi there',
};

describe('ConsoleSender', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('exposes the adapter name "console"', () => {
    expect(ConsoleSender().name).toBe('console');
  });

  it('resolves ok with a console-prefixed id', async () => {
    const result = await ConsoleSender().send(baseMessage);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toMatch(/^console-\d+$/);
    }
  });

  it('logs the subject, recipient, and the plain-text body when text is present', async () => {
    await ConsoleSender().send(baseMessage);
    const logged = logSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(logged).toContain('subject: Welcome');
    expect(logged).toContain('to:      user@test.dev');
    expect(logged).toContain('Hi there');
    // The HTML tags are not shown because a text fallback exists.
    expect(logged).not.toContain('<b>');
  });

  it('joins an array of recipients with a comma in the log', async () => {
    await ConsoleSender().send({ ...baseMessage, to: ['a@test.dev', 'b@test.dev'] });
    const logged = logSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(logged).toContain('a@test.dev, b@test.dev');
  });

  it('falls back to stripped HTML (first 400 chars) when no text body is provided', async () => {
    const html = `<p>${'X'.repeat(500)}</p>`;
    await ConsoleSender().send({ to: 'u@test.dev', subject: 'S', html });
    const logged = logSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    // Tags are stripped, leaving the raw text, capped at 400 chars.
    expect(logged).toContain('X'.repeat(400));
    expect(logged).not.toContain('X'.repeat(401));
    expect(logged).not.toContain('<p>');
  });

  it('renders "(default)" for the from line when the message omits from', async () => {
    await ConsoleSender().send(baseMessage);
    const logged = logSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(logged).toContain('from:    (default)');
  });

  it('shows the message from address when supplied', async () => {
    await ConsoleSender().send({ ...baseMessage, from: 'noreply@acme.test' });
    const logged = logSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(logged).toContain('from:    noreply@acme.test');
  });
});
