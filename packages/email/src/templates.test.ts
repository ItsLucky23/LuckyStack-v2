import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  resetEmailTemplatesForTests,
} from './templates';
import type { EmailTemplate } from './templates';

//? The template registry is a module-level Map. `resetEmailTemplatesForTests`
//? is the only state-reset seam, so it runs in beforeEach to isolate cases.

const makeTemplate = (label: string): EmailTemplate => ({
  subject: () => `subject:${label}`,
  render: () => ({ html: `<p>${label}</p>`, text: label }),
});

describe('email template registry', () => {
  beforeEach(() => {
    resetEmailTemplatesForTests();
  });

  it('returns undefined for an unregistered template name', () => {
    expect(getEmailTemplate('missing')).toBeUndefined();
  });

  it('registers a template and reads it back by name', () => {
    const tpl = makeTemplate('welcome');
    registerEmailTemplate('welcome', tpl);
    expect(getEmailTemplate('welcome')).toBe(tpl);
  });

  it('returns undefined as the previous entry on first registration', () => {
    expect(registerEmailTemplate('welcome', makeTemplate('welcome'))).toBeUndefined();
  });

  it('returns the previous template when overriding an existing name', () => {
    const first = makeTemplate('first');
    const second = makeTemplate('second');
    registerEmailTemplate('welcome', first);
    const previous = registerEmailTemplate('welcome', second);
    expect(previous).toBe(first);
    expect(getEmailTemplate('welcome')).toBe(second);
  });

  it('lists registered names alphabetically', () => {
    registerEmailTemplate('zeta', makeTemplate('z'));
    registerEmailTemplate('alpha', makeTemplate('a'));
    registerEmailTemplate('mu', makeTemplate('m'));
    expect(listEmailTemplates()).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('returns an empty list when no templates are registered', () => {
    expect(listEmailTemplates()).toEqual([]);
  });

  it('clears the registry on resetEmailTemplatesForTests', () => {
    registerEmailTemplate('welcome', makeTemplate('welcome'));
    resetEmailTemplatesForTests();
    expect(getEmailTemplate('welcome')).toBeUndefined();
    expect(listEmailTemplates()).toEqual([]);
  });

  it('renders subject and body from supplied data through the registered template', () => {
    const tpl: EmailTemplate<{ name: string }> = {
      subject: (data) => `Hi ${data.name}`,
      render: (data) => ({ html: `<p>${data.name}</p>`, text: data.name }),
    };
    registerEmailTemplate('greet', tpl);
    const stored = getEmailTemplate('greet');
    expect(stored).toBeDefined();
    expect(stored?.subject({ name: 'Sam' })).toBe('Hi Sam');
    expect(stored?.render({ name: 'Sam' })).toEqual({ html: '<p>Sam</p>', text: 'Sam' });
  });
});
