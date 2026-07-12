import { faEnvelopeOpenText, faRightToBracket, faShieldHalved, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";

//? Post-redirect delay in ms: long enough for the success toast to be read,
//? short enough not to feel broken. Named to avoid a bare magic number.
const REDIRECT_DELAY_MS = 1000;

//? The form is a small state machine (ADR 0024):
//?   'credentials' — email/password + OAuth buttons (the classic view)
//?   'emailCode'   — passwordless sign-in: request a code, then enter it
//?   'twoFactor'   — the 2FA challenge after a verified first factor
type Phase = "credentials" | "emailCode" | "twoFactor";
type TwoFactorMethod = "totp" | "email-code" | "recovery-code";

//? Response envelope of every /auth/api/* login route. `status` is a BOOLEAN on
//? the auth handlers' own responses, but framework guards (CSRF, rate-limit)
//? reply with the generic error envelope `{ status: 'error', errorCode }` — a
//? truthy STRING. The union keeps the strict `=== true` check honest.
interface AuthResponse {
  status: boolean | string;
  reason?: string;
  errorCode?: string;
  session?: SessionLayout;
  authenticated?: boolean;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  twoFactorMethods?: TwoFactorMethod[];
  sessionToken: string | null;
}

//? Shared POST to an /auth/api/* login route. Mirrors the classic credentials
//? call: session-mode header + optional Bearer (so a re-login while signed in
//? SUPERSEDES this browser's own session) + cookie transport.
const postAuth = async (path: string, body: Record<string, unknown>): Promise<AuthResponse | null> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-Based-Token": String(sessionBasedToken),
  };
  if (sessionBasedToken) {
    const existingToken = sessionStorage.getItem("token");
    if (existingToken) headers.Authorization = `Bearer ${existingToken}`;
  }
  const [error, response] = await tryCatch(async () => {
    const res = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "include",
    });
    const parsed = (await res.json()) as Omit<AuthResponse, "sessionToken">;
    return { ...parsed, sessionToken: res.headers.get("x-session-token") };
  });
  if (error || !response) {
    notify.error({ key: 'common.404' });
    console.error(error ?? "No JSON response");
    return null;
  }
  return response;
};

export default function LoginForm({ formType }: { formType: "login" | "register" }) {
  const translate = useTranslator();
  //? Preserve the current search params (e.g. ?backend=8080) across the
  //? login↔register nav and the post-login redirect, so dev overrides survive.
  const { search } = useLocation();
  const isLogin = formType === "login";
  const title = isLogin ? translate({ key: 'login.signInTitle' }) : translate({ key: 'login.registerTitle' });
  const subtitleText = isLogin ? translate({ key: 'login.noAccount' }) : translate({ key: 'login.haveAccount' });
  const subtitleLink = isLogin ? translate({ key: 'login.createAccount' }) : translate({ key: 'login.logIn' });
  const redirectURL = isLogin ? `/register${search}` : `/login${search}`;
  const buttonText = isLogin ? translate({ key: 'login.logIn' }) : translate({ key: 'login.signUp' });

  const inputClass = "rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";
  const linkButtonClass = "text-xs text-primary hover:text-primary-hover cursor-pointer bg-transparent border-none p-0 text-left";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("credentials");
  //? 2FA challenge state (token + which methods the account can answer with).
  const [challenge, setChallenge] = useState<{ token: string; methods: TwoFactorMethod[] } | null>(null);
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("totp");
  //? email-code phase state — controlled inputs (unlike the classic form, these
  //? views swap in/out, so uncontrolled DOM reads would lose values).
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);

  //? The login form is driven entirely by the server's env-based registry
  //? (`GET /auth/providers`) — the single source of truth. A provider is active
  //? only when its credentials env vars are set; `credentials` (email+password)
  //? is present when `auth.credentials` is enabled. Secrets never reach the
  //? browser. We split the returned list: `credentials` gates the form fields,
  //? everything else becomes an OAuth button. `emailCodeLogin` (ADR 0024)
  //? gates the passwordless entry point.
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [showCredentials, setShowCredentials] = useState(false);
  const [emailCodeAvailable, setEmailCodeAvailable] = useState(false);
  //? Gate the whole form on the providers fetch so the OAuth buttons + credential
  //? fields render once, fully-formed, instead of popping in after the rest
  //? (which caused a visible layout shift on every mount / login↔register nav).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [error, response] = await tryCatch(() =>
        fetch(`${backendUrl}/auth/providers`, { signal: controller.signal }),
      );
      if (error || !response?.ok) { setReady(true); return; }
      const [parseError, body] = await tryCatch(() => response.json() as Promise<{ providers?: string[]; emailCodeLogin?: boolean }>);
      if (parseError || !Array.isArray(body?.providers)) { setReady(true); return; }
      setShowCredentials(body.providers.includes("credentials"));
      setOauthProviders(body.providers.filter((name) => name !== "credentials"));
      setEmailCodeAvailable(body.emailCodeLogin === true);
      setReady(true);
    })();
    return () => { controller.abort(); };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonRef.current?.click();
    }
  };

  //? Shared outcome handling for every login-completing response:
  //? failure → toast; 2FA challenge → switch to the challenge phase;
  //? full success → store the token (token mode) + redirect.
  const handleAuthOutcome = (response: AuthResponse): void => {
    //? Success is ONLY a literal boolean `true`. Anything else — `false`, or the
    //? framework error envelope's `'error'` string — is a failure. (Without the
    //? strict `=== true`, a 403 CSRF reply `{ status: 'error' }` slipped through
    //? as success: empty green toast + bounce back to /login.)
    if (response.status !== true) {
      const reasonKey = [response.reason, response.errorCode].find(
        (key): key is string => typeof key === 'string' && key.length > 0,
      ) ?? 'api.internalServerError';
      notify.error({ key: reasonKey });
      setLoading(false);
      return;
    }

    if (response.requiresTwoFactor && response.challengeToken) {
      setChallenge({ token: response.challengeToken, methods: response.twoFactorMethods ?? ["totp"] });
      setTwoFactorMethod("totp");
      setCodeInput("");
      setPhase("twoFactor");
      setLoading(false);
      return;
    }

    notify.success({ key: response.reason ?? 'login.loggedIn' });
    setTimeout(() => {
      if (response.sessionToken && sessionBasedToken) {
        sessionStorage.setItem("token", response.sessionToken);
      } else if (!sessionBasedToken) {
        //? Cookie mode: drop any stale sessionStorage token left behind by a
        //? previous token-mode session — a leftover entry makes parts of the
        //? client mis-detect the auth mode.
        sessionStorage.removeItem("token");
      }
      //? Preserve the current search params (e.g. ?backend=8080) so dev
      //? overrides stay visible in the URL on the next page. Relative paths
      //? keep the current frontend origin, so :5174 stays :5174.
      const target = response.authenticated ? loginRedirectUrl : loginPageUrl;
      globalThis.location.href = `${target}${search}`;
    }, REDIRECT_DELAY_MS);
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      //? Pass the desired post-auth landing URL as ?return_url so the server
      //? stores it alongside the OAuth state and uses it for the callback
      //? redirect. This ensures the browser ends up on the correct frontend
      //? origin (e.g. :5174 instead of the hardcoded publicUrl :5173) and that
      //? the configured loginRedirectUrl path is honoured regardless of which
      //? backend port handled the OAuth flow.
      const returnUrl = encodeURIComponent(`${globalThis.location.origin}${loginRedirectUrl}`);
      globalThis.location.href = `${backendUrl}/auth/api/${provider}?return_url=${returnUrl}`;
      return;
    }

    const form = (e.target as HTMLElement).closest("form");
    if (!form) {
      setLoading(false);
      console.error("Form not found"); return;
    }

    const getValue = (name: string): string => {
      const input = form.querySelector(`input[name="${name}"]`);
      return (input as HTMLInputElement | null)?.value ?? "";
    };

    const response = await postAuth('/auth/api/credentials', {
      name: getValue("name"),
      email: getValue("email"),
      password: getValue("password"),
      confirmPassword: getValue("confirmPassword"),
      provider,
    });
    if (!response) { setLoading(false); return; }
    handleAuthOutcome(response);
  };

  //? ── email-code phase actions ──
  const handleEmailCodeRequest = async (): Promise<void> => {
    if (loading || !emailInput.trim()) return;
    setLoading(true);
    const response = await postAuth('/auth/api/email-code/request', { email: emailInput });
    setLoading(false);
    if (!response) return;
    if (response.status === true) {
      setEmailCodeSent(true);
      notify.success({ key: 'login.emailCodeSent' });
    } else {
      notify.error({ key: response.reason ?? 'api.internalServerError' });
    }
  };

  const handleEmailCodeVerify = async (): Promise<void> => {
    if (loading || !codeInput.trim()) return;
    setLoading(true);
    const response = await postAuth('/auth/api/email-code/verify', { email: emailInput, code: codeInput });
    if (!response) { setLoading(false); return; }
    handleAuthOutcome(response);
  };

  //? ── 2FA phase actions ──
  const handleTwoFactorVerify = async (): Promise<void> => {
    if (loading || !codeInput.trim() || !challenge) return;
    setLoading(true);
    const response = await postAuth('/auth/api/2fa', {
      challengeToken: challenge.token,
      code: codeInput,
      method: twoFactorMethod,
    });
    if (!response) { setLoading(false); return; }
    handleAuthOutcome(response);
  };

  const handleTwoFactorEmailCode = async (): Promise<void> => {
    if (loading || !challenge) return;
    setLoading(true);
    const response = await postAuth('/auth/api/2fa/email-code', { challengeToken: challenge.token });
    setLoading(false);
    if (!response) return;
    if (response.status === true) {
      setTwoFactorMethod("email-code");
      setCodeInput("");
      notify.success({ key: 'login.twoFactorEmailSent' });
    } else {
      notify.error({ key: response.reason ?? 'api.internalServerError' });
    }
  };

  const headerIcon = (() => {
    if (phase === "twoFactor") return faShieldHalved;
    if (phase === "emailCode") return faEnvelopeOpenText;
    return isLogin ? faRightToBracket : faUserPlus;
  })();

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- form container needs Enter key handling */
    <form
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="p-6 bg-container1 border border-container1-border rounded-xl shadow-sm text-title flex flex-col gap-5 max-w-[360px] w-full"
    >
        <div className="flex flex-col items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <FontAwesomeIcon icon={headerIcon} size="lg" />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="font-semibold text-lg leading-tight">
              {phase === "twoFactor" && translate({ key: 'login.twoFactorTitle' })}
              {phase === "emailCode" && translate({ key: 'login.emailCodeTitle' })}
              {phase === "credentials" && title}
            </h1>
            {phase === "credentials" && (
              <p className="text-xs text-common">
                {subtitleText}
                <Link to={redirectURL} className="text-primary hover:text-primary-hover font-medium cursor-pointer">
                  {subtitleLink}
                </Link>
              </p>
            )}
            {phase === "twoFactor" && (
              <p className="text-xs text-common">
                {twoFactorMethod === "totp" && translate({ key: 'login.twoFactorIntro' })}
                {twoFactorMethod === "email-code" && translate({ key: 'login.twoFactorEmailIntro' })}
                {twoFactorMethod === "recovery-code" && translate({ key: 'login.twoFactorRecoveryIntro' })}
              </p>
            )}
            {phase === "emailCode" && (
              <p className="text-xs text-common">{translate({ key: 'login.emailCodeIntro' })}</p>
            )}
          </div>
        </div>

        {!ready && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-container1-border border-t-primary animate-spin" />
          </div>
        )}

        {ready && phase === "twoFactor" && challenge && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="twoFactorCode" className="font-medium text-xs">{translate({ key: 'login.twoFactorCodeLabel' })}</label>
              <input
                id="twoFactorCode"
                name="twoFactorCode"
                type="text"
                inputMode={twoFactorMethod === "recovery-code" ? "text" : "numeric"}
                autoComplete="one-time-code"
                placeholder={twoFactorMethod === "recovery-code" ? "xxxxx-xxxxx" : "123456"}
                value={codeInput}
                onChange={(e) => { setCodeInput(e.target.value); }}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              ref={buttonRef}
              className="mt-1 h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
              onClick={() => void handleTwoFactorVerify()}
              disabled={loading}
            >
              {loading ? translate({ key: 'login.loading' }) : translate({ key: 'login.twoFactorVerify' })}
            </button>
            <div className="flex flex-col gap-1">
              {twoFactorMethod !== "totp" && (
                <button type="button" className={linkButtonClass} onClick={() => { setTwoFactorMethod("totp"); setCodeInput(""); }}>
                  {translate({ key: 'login.twoFactorUseTotp' })}
                </button>
              )}
              {twoFactorMethod !== "email-code" && challenge.methods.includes("email-code") && (
                <button type="button" className={linkButtonClass} onClick={() => void handleTwoFactorEmailCode()}>
                  {translate({ key: 'login.twoFactorUseEmail' })}
                </button>
              )}
              {twoFactorMethod !== "recovery-code" && (
                <button type="button" className={linkButtonClass} onClick={() => { setTwoFactorMethod("recovery-code"); setCodeInput(""); }}>
                  {translate({ key: 'login.twoFactorUseRecovery' })}
                </button>
              )}
            </div>
          </div>
        )}

        {ready && phase === "emailCode" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="emailCodeEmail" className="font-medium text-xs">{translate({ key: 'login.emailAddress' })}</label>
              <input
                id="emailCodeEmail"
                name="emailCodeEmail"
                type="email"
                placeholder="johnpork@gmail.com"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); }}
                disabled={emailCodeSent}
                className={inputClass}
              />
            </div>
            {emailCodeSent && (
              <div className="flex flex-col gap-1">
                <label htmlFor="emailCodeCode" className="font-medium text-xs">{translate({ key: 'login.emailCodeLabel' })}</label>
                <input
                  id="emailCodeCode"
                  name="emailCodeCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value); }}
                  className={inputClass}
                />
              </div>
            )}
            <button
              type="button"
              ref={buttonRef}
              className="mt-1 h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
              onClick={() => void (emailCodeSent ? handleEmailCodeVerify() : handleEmailCodeRequest())}
              disabled={loading}
            >
              {loading
                ? translate({ key: 'login.loading' })
                : (emailCodeSent ? translate({ key: 'login.logIn' }) : translate({ key: 'login.emailCodeSend' }))}
            </button>
            <div className="flex flex-col gap-1">
              {emailCodeSent && (
                <button type="button" className={linkButtonClass} onClick={() => void handleEmailCodeRequest()}>
                  {translate({ key: 'login.emailCodeResend' })}
                </button>
              )}
              <button
                type="button"
                className={linkButtonClass}
                onClick={() => { setPhase("credentials"); setEmailCodeSent(false); setCodeInput(""); }}
              >
                {translate({ key: 'login.backToPassword' })}
              </button>
            </div>
          </div>
        )}

        {ready && phase === "credentials" && showCredentials && (
          <>
            <div className="flex flex-col gap-3">
              {!isLogin && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="name" className="font-medium text-xs">{translate({ key: 'login.name' })}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="John Pork"
                    className={inputClass}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="font-medium text-xs">{translate({ key: 'login.emailAddress' })}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="johnpork@gmail.com"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="font-medium text-xs">{translate({ key: 'login.password' })}</label>
                  {isLogin && (
                    <Link to="/reset-password" className="text-xs text-primary hover:text-primary-hover cursor-pointer">
                      {translate({ key: 'login.forgotPassword' })}
                    </Link>
                  )}
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="********"
                  className={inputClass}
                />
              </div>
              {!isLogin && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="confirmPassword" className="font-medium text-xs">{translate({ key: 'login.confirmPassword' })}</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="********"
                    className={inputClass}
                  />
                </div>
              )}

              <button
                type="button"
                ref={buttonRef}
                className="mt-1 h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
                onClick={(e) => void handleSubmit(e, "credentials")}
                disabled={loading}
              >
                {loading ? translate({ key: 'login.loading' }) : buttonText}
              </button>

              {isLogin && emailCodeAvailable && (
                <button
                  type="button"
                  className={`${linkButtonClass} text-center`}
                  onClick={() => { setPhase("emailCode"); setEmailInput(""); setCodeInput(""); setEmailCodeSent(false); }}
                >
                  {translate({ key: 'login.emailCodeTab' })}
                </button>
              )}
            </div>

            {oauthProviders.length > 0 && (
              <div className="flex items-center w-full text-common text-xs before:flex-1 before:border-t before:border-container1-border before:content-[''] after:flex-1 after:border-t after:border-container1-border after:content-['']">
                <span className="px-3">{translate({ key: 'login.orContinueWith' })}</span>
              </div>
            )}
          </>
        )}

        {ready && phase === "credentials" && oauthProviders.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {oauthProviders.map((provider) => (
              <button
                type="button"
                key={provider}
                onClick={(e) => void handleSubmit(e, provider)}
                className="h-9 rounded-md cursor-pointer bg-container1 text-title text-sm border border-container1-border flex gap-2 items-center justify-center hover:bg-container1-hover transition-colors"
              >
                <img src={`/${provider}.png`} alt={provider} className="w-4 h-4" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span>{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
              </button>
            ))}
          </div>
        )}
    </form>
  );
}
