# Email Templates & `renderEmailLayout`

> Deep-doc for the email layout helper and template registry. See also:
> - Adapters: `packages/email/docs/adapters.md`
> - Hooks: `packages/email/docs/hooks.md`
> - Password-reset integration: `packages/email/docs/password-reset-integration.md`
> - Architecture: `docs/ARCHITECTURE_EMAIL.md`

There are two levels of templating in `@luckystack/email`:

1. **`renderEmailLayout({...})`** — a tiny inline-styled HTML+text generator with one optional CTA button. Use it directly when you build an email at the call site (no name, no `data` payload).
2. **The named template registry (`registerEmailTemplate` / `getEmailTemplate`)** — register an `EmailTemplate<TData>` under a short name and dispatch with `sendEmail({ template: 'name', data })`. Used by framework packages (currently `@luckystack/login`) and by application code that wants overrideable, data-driven email content.

You can mix both freely. The framework's password-reset and email-change emails dispatch through the named registry (`sendEmail({ template: 'password-reset' | 'email-change', data })`); `@luckystack/email` ships built-in templates for both names, so they work out of the box, and a project can override the copy by registering its own template under the same name (see `docs/password-reset-integration.md`).

---

## `renderEmailLayout(input)`

```ts
import { renderEmailLayout } from '@luckystack/email';

const { html, text } = renderEmailLayout({
  brand: 'LuckyStack',
  title: 'Verify your address',
  intro: 'Click below to verify your account. The link expires in 24 hours.',
  ctaLabel: 'Verify',
  ctaUrl: 'https://app.example.com/verify?token=...',
  outro: 'If the button does not work, copy the link into your browser.',
  footer: 'You received this because someone signed up at example.com.',
  accent: '#3B82F6',
});
```

### Input — `RenderEmailLayoutInput`

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `title` | `string` | yes | Used as the `<title>` tag, the H1 heading, and (by convention) the email subject if the caller wants symmetry. |
| `intro` | `string` | yes | First paragraph after the heading. Plain text — never HTML. |
| `ctaLabel` | `string` | optional | Label on the CTA button. The button only renders when **both** `ctaLabel` and `ctaUrl` are set. |
| `ctaUrl` | `string` | optional | Absolute URL the CTA button links to. Render-time pair with `ctaLabel`. |
| `outro` | `string` | optional | Second paragraph below the CTA. Typically a "if the button does not work" fallback or a soft-ignore message ("if you didn't request this..."). |
| `footer` | `string` | optional | Small footer line below a horizontal divider. Best used for unsubscribe / origin disclosure. |
| `brand` | `string` | optional | Brand label shown above the H1 in uppercase letter-spacing. |
| `accent` | `string` | optional | Hex color for the CTA button background. Default `#3B82F6` (LuckyStack neutral). |

### Output — `RenderedEmail`

```ts
interface RenderedEmail {
  html: string;
  text: string;
}
```

- `html` is a complete `<!doctype html>` document. Inline styles only (no `<style>` blocks) so the major mail clients (Gmail, Outlook desktop, Apple Mail) render reliably.
- `text` is a plain-text fallback: brand, title, intro, optional `<ctaLabel>: <ctaUrl>` line, outro, and a `---` divider before the footer. The CTA URL is included unescaped in the text body so the recipient can copy/paste.

### Why inline styles only

Most mail clients (Gmail, Outlook.com, several mobile clients) strip `<style>` blocks before rendering. Even on clients that respect them, layout breakage from media-query stripping is a common source of "looks fine in dev, broken in inbox" bugs. `renderEmailLayout` sidesteps this entirely by inlining every style on the element it applies to.

### HTML safety

All caller-supplied strings (`title`, `intro`, `outro`, `footer`, `brand`, `ctaLabel`) are run through a small `escapeHtml` pass before being interpolated into the document. This is a safety net only — never pass user-supplied HTML to `renderEmailLayout`. If you need HTML inside the body (e.g. a list of invitees), build the document yourself and skip this helper.

`ctaUrl` is *not* HTML-escaped because the existing escapes (`&` -> `&amp;`) would corrupt query-string URLs. Validate or whitelist the URL before passing it in (`encodeURIComponent` on individual params is the usual answer).

### When the CTA is not rendered

- Either `ctaLabel` or `ctaUrl` is missing — the button block is omitted entirely, and the plain-text body skips the CTA line.
- Both are set but `ctaUrl` is not absolute — `renderEmailLayout` does not validate this; mail clients usually break the link silently. Always pass absolute URLs (`https://` prefix included).

---

## The named template registry

A template is a name plus two functions:

```ts
import type { EmailTemplate } from '@luckystack/email';

interface EmailTemplate<TData = Record<string, unknown>> {
  subject: (data: TData) => string;
  render: (data: TData) => RenderedEmail;
}
```

`subject(data)` returns the email subject line, `render(data)` returns the `{ html, text }` body. Both receive the same `data` payload passed to `sendEmail({ template, data, to })`.

### Registry API

| Function | Purpose |
| --- | --- |
| `registerEmailTemplate(name, template)` | Register or override a template. Returns the previously registered template under that name (or `undefined`) so callers wiring overlays can chain. Last-write-wins. |
| `getEmailTemplate(name)` | Read a template by name. Returns `undefined` when no template is registered under that name. |
| `listEmailTemplates()` | Returns every registered name, alphabetically. Diagnostic helper. |
| `resetEmailTemplatesForTests()` | Clears the registry. Test-only — never call this in production code. |

The registry is a process-local `Map`. There's no persistence — every server restart starts empty, and every install must register its templates at boot.

### Resolution order inside `sendEmail`

When you call `sendEmail({ to, template: 'foo', data: {...} })`:

1. `sendEmail` looks up a consumer-registered template via `getEmailTemplate('foo')`.
2. If none is registered, it falls back to a framework built-in via `getBuiltInEmailTemplate('foo')` (`'password-reset'` and `'email-change'` ship built-in).
3. If a template resolves (registered or built-in), `subject` and `render` are called with `data ?? {}`. The result becomes the outgoing `EmailMessage`.
4. If neither a registration nor a built-in exists for that name, `sendEmail` returns `{ ok: false, reason: 'no-template' }` and (when `logging.errors` is on) warns in the terminal.

> **Built-in fallbacks.** `@luckystack/email` ships built-in templates for `'password-reset'` and `'email-change'` (in `builtInTemplates.ts`), each rendered via `renderEmailLayout`. `@luckystack/login`'s `sendPasswordResetEmail` / `sendEmailChangeConfirmation` dispatch through these names (`sendEmail({ template: 'password-reset' | 'email-change', data, to, adapterHint: 'transactional' })`), so the flow works out of the box. A project that wants different copy — translation, branding, extra marketing block — just registers its own template under the same name with `registerEmailTemplate(...)` (last-write-wins); no fork of `@luckystack/login` is needed. Introspect the shipped built-ins with `listBuiltInEmailTemplates()` / `getBuiltInEmailTemplate(name)`.

### Overriding a template

`registerEmailTemplate` returns the previous registration, so wrapping a parent template is a one-liner:

```ts
import { registerEmailTemplate, getEmailTemplate, renderEmailLayout } from '@luckystack/email';

const previous = registerEmailTemplate('welcome', {
  subject: () => 'Welcome aboard',
  render: () =>
    renderEmailLayout({
      brand: 'Acme',
      title: 'Welcome',
      intro: 'Glad you joined us.',
      ctaLabel: 'Open dashboard',
      ctaUrl: 'https://app.example.com',
    }),
});

// `previous` is the template that used to be registered under 'welcome', or undefined.
// Useful for installers that want to wrap a framework default with extra content.
```

Because the registry is last-write-wins, the order of boot-time registrations matters. Run installer overrides *after* framework registrations.

### Asynchronous rendering

`subject` and `render` are declared as synchronous. If you need async work (e.g. resolving the recipient's display name from the database) prepare the data *before* calling `sendEmail`:

```ts
const userPrefs = await fetchPrefs(userId);
await sendEmail({
  to: user.email,
  template: 'invoice-receipt',
  data: { user, prefs: userPrefs, total },
});
```

Putting the DB call inside `render` would block the per-template signature and break overrides — keep the I/O at the call site.

---

## i18n integration

The email package does not own a translator. Project-side i18n integration follows one convention:

- Callers derive the recipient's language from their session (`await getSession(token)` -> `session.language`) before calling `sendEmail`.
- The language code is passed via the `data` payload as `language: 'en' | 'nl' | 'de' | 'fr' | ...`.
- The template's `subject` and `render` switch on `data.language`.

Example multi-language template:

```ts
import { registerEmailTemplate, renderEmailLayout } from '@luckystack/email';

interface InviteData {
  inviterName: string;
  acceptUrl: string;
  brand: string;
  language?: string;
}

const COPY: Record<string, { subject: string; title: string; intro: (name: string) => string; cta: string; footer: string }> = {
  en: {
    subject: 'You have been invited',
    title: 'Join the team',
    intro: (name) => `${name} invited you to collaborate.`,
    cta: 'Accept invite',
    footer: 'If you didn\'t expect this email, ignore it.',
  },
  nl: {
    subject: 'Je bent uitgenodigd',
    title: 'Word lid van het team',
    intro: (name) => `${name} heeft je uitgenodigd om samen te werken.`,
    cta: 'Uitnodiging accepteren',
    footer: 'Was deze e-mail niet voor jou? Negeer hem dan.',
  },
};

registerEmailTemplate<InviteData>('team-invite', {
  subject: (data) => (COPY[data.language ?? 'en'] ?? COPY.en).subject,
  render: (data) => {
    const copy = COPY[data.language ?? 'en'] ?? COPY.en;
    return renderEmailLayout({
      brand: data.brand,
      title: copy.title,
      intro: copy.intro(data.inviterName),
      ctaLabel: copy.cta,
      ctaUrl: data.acceptUrl,
      footer: copy.footer,
    });
  },
});
```

Call site:

```ts
const session = await getSession(invitee.sessionToken);
await sendEmail({
  to: invitee.email,
  template: 'team-invite',
  data: {
    inviterName: inviter.name,
    acceptUrl: 'https://app.example.com/invite/abc',
    brand: 'Acme',
    language: session?.language ?? 'en',
  },
});
```

Storing the dictionary inside the template module keeps each language's copy reviewable alongside the template — usually better than reaching for a heavy i18n runtime for transactional mail.

---

## Worked examples

### A. Brand-customized password-reset

Project boot:

```ts
import { registerEmailTemplate, renderEmailLayout } from '@luckystack/email';

registerEmailTemplate('password-reset', {
  subject: (data) => `Reset your ${(data as { brand?: string }).brand ?? 'Acme'} password`,
  render: (data) => {
    const d = data as { brand?: string; userName?: string; resetUrl: string; ttlMinutes: number };
    return renderEmailLayout({
      brand: d.brand ?? 'Acme',
      title: 'Reset your password',
      intro: `Hi ${d.userName ?? 'there'}, click the button below to choose a new password. The link expires in ${String(d.ttlMinutes)} minutes.`,
      ctaLabel: 'Reset password',
      ctaUrl: d.resetUrl,
      outro: `If the button doesn't work, paste this URL into your browser: ${d.resetUrl}`,
      footer: `Sent by ${d.brand ?? 'Acme'}. Did not request this? Ignore the email — your password stays the same.`,
      accent: '#7C3AED',
    });
  },
});
```

That's all that's needed: `@luckystack/login`'s `sendPasswordResetEmail` already dispatches `sendEmail({ template: 'password-reset', data: { brand, userName, resetUrl, ttlMinutes }, adapterHint: 'transactional' })`, so registering `'password-reset'` above (at boot, before the first reset request) transparently replaces the built-in copy — no change to the login flow or a custom reset API required. See `docs/password-reset-integration.md` for the full integration story.

### B. Multi-language invite

See the `team-invite` example above — register once at boot, every later `sendEmail({ template: 'team-invite', data: { ..., language } })` automatically picks the right copy.

### C. Fully custom HTML (skip `renderEmailLayout`)

For receipts, tables, or anything outside the one-CTA layout, bypass `renderEmailLayout` entirely:

```ts
import { registerEmailTemplate } from '@luckystack/email';

registerEmailTemplate<{ total: number; items: { name: string; price: number }[]; receiptUrl: string }>('order-receipt', {
  subject: (data) => `Your receipt — €${data.total.toFixed(2)}`,
  render: (data) => {
    const rows = data.items
      .map((item) => `<tr><td style="padding:8px 0;">${item.name}</td><td style="padding:8px 0;text-align:right;">€${item.price.toFixed(2)}</td></tr>`)
      .join('');
    const html = `<!doctype html>
<html><body style="font-family:system-ui;color:#1E1F21;">
  <h1>Thanks for your order</h1>
  <table cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #e5e5e5;">${rows}</table>
  <p>Total: <strong>€${data.total.toFixed(2)}</strong></p>
  <p><a href="${data.receiptUrl}">View receipt online</a></p>
</body></html>`;
    const text = [
      'Thanks for your order',
      ...data.items.map((item) => `- ${item.name}: EUR ${item.price.toFixed(2)}`),
      `Total: EUR ${data.total.toFixed(2)}`,
      `Receipt: ${data.receiptUrl}`,
    ].join('\n');
    return { html, text };
  },
});
```

When you skip `renderEmailLayout`, you own the inline-styles discipline yourself — keep everything inline, test on Gmail + Outlook, and consider using a higher-level library (MJML, React Email) if the layout grows past a single page.

---

## Edge cases

| Situation | Behaviour |
| --- | --- |
| `sendEmail({ template: 'foo', ... })` and `'foo'` is not registered | Returns `{ ok: false, reason: 'no-template' }`. The configured `from` is *not* applied (no message is built). `logging.errors` warns in terminal. |
| `data` omitted on a template call | Treated as `{}`. The template's `subject` / `render` must tolerate empty data — if they throw, `sendEmail` catches the throw and returns `{ ok: false, reason: 'template-render-failed' }`. |
| `render` or `subject` throws | `sendEmail` catches it (via `tryCatchSync`) and returns `{ ok: false, reason: 'template-render-failed' }`. No try/catch is needed at the call site — the failure is already a typed result. |
| `subject` returns empty string | Sent as-is. Some providers reject empty subjects — verify in your adapter test. |
| Template registered twice under the same name | Last `registerEmailTemplate` wins. Returning the previous registration lets you chain (see "Overriding a template" above). |
| `resetEmailTemplatesForTests` in production | Removes *all* registrations, including framework-internal ones. Test-only — never call from production code paths. |

---

## Related

- Send pipeline: `packages/email/src/sendEmail.ts`
- Registry source: `packages/email/src/templates.ts`
- Layout helper source: `packages/email/src/renderEmailLayout.ts`
- Login's inline use of `renderEmailLayout`: `packages/login/src/forgotPassword.ts`
