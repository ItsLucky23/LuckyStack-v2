//? Minimal HTML + plain-text email template. Inline styles only (most clients
//? strip <style> blocks). One CTA button optional. Keeps the surface tiny so
//? consumers don't need React Email / MJML for transactional messages.

import { escapeHtml } from '@luckystack/core';

const ALLOWED_CTA_SCHEMES = new Set(['https:', 'http:']);

//? Validates ctaUrl against a scheme allowlist so javascript:/data: URIs
//? cannot reach the href attribute. Returns null when the URL is unsafe or
//? unparseable, suppressing the CTA block entirely (fail-closed).
const safeCta = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_CTA_SCHEMES.has(parsed.protocol)) return null;
    return escapeHtml(parsed.href);
  } catch {
    return null;
  }
};

//? Validates accent to a hex color or named CSS color keyword so a
//? consumer-supplied value cannot break out of the inline style attribute
//? (e.g. via `; color: red` CSS injection). Falls back to the default blue.
const safeAccent = (accent: string): string =>
  /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/.test(accent) ? accent : '#3B82F6';

export interface RenderEmailLayoutInput {
  /** Email title shown as the H1 heading and (optionally) used by the caller as the subject. */
  title: string;
  /** First paragraph after the heading. Plain string, no HTML. */
  intro: string;
  /** Optional CTA button label. */
  ctaLabel?: string;
  /** Optional absolute URL the CTA button links to. */
  ctaUrl?: string;
  /** Optional second paragraph below the CTA (e.g. a fallback link). */
  outro?: string;
  /** Optional small footer line below the divider. */
  footer?: string;
  /** Sender / brand label shown in the email header. */
  brand?: string;
  /** Accent color for the heading + CTA button. Defaults to a neutral indigo. */
  accent?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export const renderEmailLayout = ({
  title,
  intro,
  ctaLabel,
  ctaUrl,
  outro,
  footer,
  brand,
  accent = '#3B82F6',
}: RenderEmailLayoutInput): RenderedEmail => {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeOutro = outro ? escapeHtml(outro) : '';
  const safeFooter = footer ? escapeHtml(footer) : '';
  const safeBrand = brand ? escapeHtml(brand) : '';
  const safeCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : '';
  const safeAccentValue = safeAccent(accent);

  // Validate ctaUrl scheme so javascript:/data: cannot reach href (EMAIL-O3).
  const safeCtaHref = ctaUrl ? safeCta(ctaUrl) : null;

  const ctaBlock = ctaLabel && safeCtaHref
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin:24px 0;">
        <tr>
          <td style="border-radius:6px;background:${safeAccentValue};">
            <a href="${safeCtaHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 18px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${safeCtaLabel}</a>
          </td>
        </tr>
      </table>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;color:#1E1F21;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;">
            <tr>
              <td style="padding:24px 28px 0 28px;">
                ${safeBrand ? `<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:600;">${safeBrand}</div>` : ''}
                <h1 style="margin:8px 0 16px 0;font-size:20px;font-weight:600;color:#1E1F21;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;font-size:14px;line-height:1.6;color:#454648;">
                <p style="margin:0 0 16px 0;">${safeIntro}</p>
                ${ctaBlock}
                ${safeOutro ? `<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">${safeOutro}</p>` : ''}
              </td>
            </tr>
            ${safeFooter ? `
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e5e5e5;font-size:12px;color:#9ca3af;">
                ${safeFooter}
              </td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // Plain-text fallback
  const textParts: string[] = [];
  if (brand) textParts.push(brand);
  textParts.push(title, '', intro);
  // Only include the CTA in plain text when the URL passed the scheme check.
  if (ctaLabel && safeCtaHref && ctaUrl) textParts.push('', `${ctaLabel}: ${ctaUrl}`);
  if (outro) textParts.push('', outro);
  if (footer) textParts.push('', '---', footer);

  return { html, text: textParts.join('\n') };
};
