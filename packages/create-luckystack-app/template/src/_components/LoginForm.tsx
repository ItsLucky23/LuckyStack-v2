import { faRightToBracket, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, providers, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";

export default function LoginForm({ formType }: { formType: "login" | "register" }) {
  const translate = useTranslator();
  const isLogin = formType === "login";
  const title = isLogin ? "Sign in to your account" : "Create a new account";
  const subtitleText = isLogin ? "Don't have an account yet? " : "Already have an account? ";
  const subtitleLink = isLogin ? "Create one now" : "Log in";
  const redirectURL = isLogin ? "/register" : "/login";
  const buttonText = isLogin ? "Log in" : "Sign up";
  const headerIcon = isLogin ? faRightToBracket : faUserPlus;

  const inputClass = "rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);

  //? OAuth buttons are driven by the server's env-based registry (a provider is
  //? active only when its credentials env vars are set). We ask the server which
  //? providers are enabled — secrets never reach the browser. `credentials` is
  //? filtered out here; the email/password form is gated by config instead.
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [error, response] = await tryCatch(() =>
        fetch(`${backendUrl}/auth/providers`, { signal: controller.signal }),
      );
      if (error || !response?.ok) return;
      const [parseError, body] = await tryCatch(() => response.json() as Promise<{ providers?: string[] }>);
      if (parseError || !Array.isArray(body?.providers)) return;
      setOauthProviders(body.providers.filter((name) => name !== "credentials"));
    })();
    return () => { controller.abort(); };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonRef.current?.click();
    }
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      globalThis.location.href = `${backendUrl}/auth/api/${provider}`;
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

    const name = getValue("name");
    const email = getValue("email");
    const password = getValue("password");
    const confirmPassword = getValue("confirmPassword");

    const fetchUser = async () => {
      const res = await fetch(`${backendUrl}/auth/api/credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Based-Token": String(sessionBasedToken),
        },
        body: JSON.stringify({ name, email, password, confirmPassword, provider }),
        credentials: "include",
      });
      const sessionToken = res.headers.get("x-session-token");
      const body = (await res.json()) as {
        status: boolean;
        reason: string;
        session: SessionLayout | undefined;
        authenticated?: boolean;
      };

      return {
        ...body,
        sessionToken,
      };
    };

    const [error, response] = await tryCatch(fetchUser);

    if (error || !response) {
      notify.error({ key: 'common/.404' })
      console.error(error ?? "No JSON response");
      setLoading(false); return;
    }

    if (!response.status) {
      const reasonKey = typeof response.reason === 'string' && response.reason.length > 0
        ? response.reason
        : 'api.internalServerError';
      notify.error({ key: reasonKey });
      setLoading(false);
      return;
    }

    notify.success({ key: response.reason });
    setTimeout(() => {
      if (response.sessionToken && sessionBasedToken) {
        sessionStorage.setItem("token", response.sessionToken);
      }
      globalThis.location.href = response.authenticated ? loginRedirectUrl : loginPageUrl;
    }, 1000);
  };

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
            <h1 className="font-semibold text-lg leading-tight">{title}</h1>
            <p className="text-xs text-common">
              {subtitleText}
              <Link to={redirectURL} className="text-primary hover:text-primary-hover font-medium cursor-pointer">
                {subtitleLink}
              </Link>
            </p>
          </div>
        </div>

        {providers.includes("credentials") && (
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
                className="mt-1 h-9 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
                onClick={(e) => void handleSubmit(e, "credentials")}
                disabled={loading}
              >
                {loading ? "Loading..." : buttonText}
              </button>
            </div>

            {oauthProviders.length > 0 && (
              <div className="flex items-center w-full text-common text-xs before:flex-1 before:border-t before:border-container1-border before:content-[''] after:flex-1 after:border-t after:border-container1-border after:content-['']">
                <span className="px-3">{translate({ key: 'login.orContinueWith' })}</span>
              </div>
            )}
          </>
        )}

        {oauthProviders.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {oauthProviders.map((provider) => (
              <button
                type="button"
                key={provider}
                onClick={(e) => void handleSubmit(e, provider)}
                className="h-9 rounded-md cursor-pointer bg-container1 text-title text-sm border border-container1-border flex gap-2 items-center justify-center hover:bg-container1-hover transition-colors"
              >
                <img src={`/${provider}.png`} alt={provider} className="w-4 h-4" />
                <span>{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
              </button>
            ))}
          </div>
        )}
    </form>
  );
}
