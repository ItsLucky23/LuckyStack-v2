//? Email-template registry. Templates wrap consumer-specific email content
//? (subject + rendered HTML/text) keyed by a short name so framework
//? packages (login password-reset, account confirmation) and consumer
//? code can dispatch without knowing the layout details.
//?
//? Resolution order at `sendEmail({ template, data, to })` time:
//?
//?   1. `registerEmailTemplate(name, ...)` registration on the active
//?      project — last-write-wins. Use this in `luckystack/email/templates.ts`
//?      to override built-in templates (e.g. swap the password-reset wording).
//?   2. If a template isn't registered AND the framework has a built-in
//?      fallback for that name (currently `'password-reset'` only), the
//?      built-in renders with `renderEmailLayout`.
//?   3. Otherwise `sendEmail` returns `{ ok: false, reason: 'no-template' }`.
//?
//? Templates can optionally read the recipient's session language for i18n:
//? supply a `language` field in `data` (callers typically derive this from
//? `getSession(token)` before calling `sendEmail`).

import type { RenderedEmail } from './renderEmailLayout';

export interface EmailTemplate<TData = Record<string, unknown>> {
  /**
   * Build the subject line. Receives the same `data` payload as `render`.
   * Return a single string; the framework does not parse it further.
   */
  subject: (data: TData) => string;
  /**
   * Build the rendered HTML + text body. Usually delegates to
   * `renderEmailLayout` and supplies title/content/CTA.
   */
  render: (data: TData) => RenderedEmail;
}

const registry = new Map<string, EmailTemplate>();

/**
 * Register or override a template by name. Returns the previously
 * registered template (or undefined) so callers wiring overlays can chain
 * — e.g. wrap the framework's default password-reset to add brand-specific
 * marketing copy below the CTA.
 */
export const registerEmailTemplate = <TData = Record<string, unknown>>(
  name: string,
  template: EmailTemplate<TData>,
): EmailTemplate | undefined => {
  const previous = registry.get(name);
  registry.set(name, template as EmailTemplate);
  return previous;
};

/** Read a registered template by name. */
export const getEmailTemplate = (name: string): EmailTemplate | undefined => registry.get(name);

/** List every registered template name (alphabetical). */
export const listEmailTemplates = (): string[] => [...registry.keys()].toSorted();

/** Test-only: clear the registry. */
export const resetEmailTemplatesForTests = (): void => {
  registry.clear();
};
