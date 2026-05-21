//? Playground-only diagnostic. The framework's password-reset flow is
//? anti-enumeration (always returns success regardless of whether the email
//? matched a user OR the underlying sendEmail() failed). That's correct for
//? production, but during dev you need to see WHY a Resend / SMTP send
//? failed (missing from, bad API key, recipient not verified on sandbox
//? sender, etc). This endpoint calls the SAME `sendEmail` pipeline but
//? transparently surfaces the result so you can debug the integration.
//?
//? Login-only so randoms can't probe your email infra. Auth-bypass on the
//? real `reset-password/sendReset` is for unauthenticated reset flows; this
//? one is purely a dev fixture.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 3;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { email: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const email = data.email.trim();
  if (!email) {
    return { status: 'error', errorCode: 'login.invalidEmailFormat' };
  }

  //? Lazy import — `@luckystack/email` is an optional peer dep. If it's
  //? not installed the catch surfaces that explicitly instead of crashing.
  interface EmailModule {
    sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string; id?: string }>;
    renderEmailLayout: (input: Record<string, unknown>) => { html: string; text: string };
  }
  // @ts-expect-error optional peer dep — types resolve at consumer install time
  const mod = (await (import('@luckystack/email') as Promise<EmailModule>).catch(() => null));
  if (!mod) {
    return {
      status: 'success',
      result: {
        ok: false,
        reason: 'email-package-not-installed',
        adapter: null,
        from: null,
      },
    };
  }

  const { sendEmail, renderEmailLayout } = mod;
  const { html, text } = renderEmailLayout({
    brand: 'LuckyStack',
    title: 'Playground test email',
    intro: `This is a diagnostic email fired from the /playground page. If you see this in your inbox, your email pipeline is wired correctly. The Resend / SMTP adapter selected at boot is shown in the API response.`,
    ctaLabel: 'Open LuckyStack docs',
    ctaUrl: 'https://github.com/ItsLucky23/LuckyStack-v2',
    outro: `Diagnostic timestamp: ${new Date().toISOString()}`,
    footer: 'Sent from the LuckyStack playground.',
  });

  const result = await sendEmail({
    to: email,
    subject: 'LuckyStack playground — test email',
    html,
    text,
  });

  //? Pass through the result as-is so the playground can show the user
  //? exactly what went wrong (missing-from, no-sender, resend error code,
  //? etc.). Anti-enumeration concerns don't apply — this is login-gated.
  return {
    status: 'success',
    result: {
      ok: result.ok,
      reason: result.reason ?? null,
      id: result.id ?? null,
    },
  };
};
