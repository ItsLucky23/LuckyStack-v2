//? Two-factor authentication management (ADR 0024). Talks to the FRAMEWORK
//? routes /auth/api/2fa/setup|enable|disable|recovery-codes — adapter-based,
//? so they work on every data layer. These are authenticated, state-changing
//? POSTs: in cookie mode the CSRF double-submit header is required, hence the
//? getCsrfToken() wiring below.
//?
//? Enrollment shows the base32 secret + otpauth:// URI for the authenticator
//? app (Google/Microsoft Authenticator, Authy, … — manual entry works in all
//? of them; render the URI as a QR code if you add a QR library).

import { useState } from "react";

import { backendUrl, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import { getCsrfToken, i18nNotify as notify, useSession, useTranslator } from "@luckystack/core/client";

type View = "status" | "enroll" | "confirm" | "recovery" | "disable" | "regenerate";

interface TwoFactorResponse {
  status: boolean | string;
  reason?: string;
  errorCode?: string;
  secret?: string;
  otpauthUri?: string;
  recoveryCodes?: string[];
}

const fail = (response: TwoFactorResponse): void => {
  const key = [response.reason, response.errorCode].find((k): k is string => typeof k === "string" && k.length > 0) ?? "api.internalServerError";
  notify.error({ key });
};

const copyText = async (value: string): Promise<void> => {
  const [copyError] = await tryCatch(() => navigator.clipboard.writeText(value));
  if (!copyError) notify.success({ key: "settings.twoFactorCopied" });
};

const postTwoFactor = async (path: string, body: Record<string, unknown>): Promise<TwoFactorResponse | null> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  //? Cookie mode: state-changing authed POSTs pass the CSRF double-submit check.
  const [, csrf] = await tryCatch(() => Promise.resolve(getCsrfToken()));
  if (typeof csrf === "string" && csrf) headers["x-csrf-token"] = csrf;
  //? Token mode: the session travels as a Bearer header instead of a cookie.
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
    return (await res.json()) as TwoFactorResponse;
  });
  if (error || !response) {
    notify.error({ key: "common.404" });
    return null;
  }
  return response;
};

export default function TwoFactorSection() {
  const translate = useTranslator();
  const { session } = useSession();
  //? The session copy can be stale right after enable/disable (it is refreshed
  //? on the next login) — track the live status locally after each action.
  const sessionEnabled = Boolean((session as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled);
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? sessionEnabled;

  const [view, setView] = useState<View>("status");
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const inputClass = "rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";
  const primaryButtonClass = "h-9 px-4 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60";
  const subtleButtonClass = "h-9 px-4 rounded-md bg-container2 text-title text-sm border border-container2-border hover:bg-container2-hover transition-colors cursor-pointer disabled:opacity-60";

  const handleSetup = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    const response = await postTwoFactor("/auth/api/2fa/setup", {});
    setLoading(false);
    if (!response) return;
    if (response.status !== true || !response.secret || !response.otpauthUri) { fail(response); return; }
    setSecret(response.secret);
    setOtpauthUri(response.otpauthUri);
    setCode("");
    setView("confirm");
  };

  const handleEnable = async (): Promise<void> => {
    if (loading || !code.trim()) return;
    setLoading(true);
    const response = await postTwoFactor("/auth/api/2fa/enable", { code });
    setLoading(false);
    if (!response) return;
    if (response.status !== true || !response.recoveryCodes) { fail(response); return; }
    setRecoveryCodes(response.recoveryCodes);
    setEnabledOverride(true);
    setCode("");
    setView("recovery");
    notify.success({ key: "settings.twoFactorEnabled" });
  };

  const handleDisable = async (): Promise<void> => {
    if (loading || !code.trim()) return;
    setLoading(true);
    const response = await postTwoFactor("/auth/api/2fa/disable", { code });
    setLoading(false);
    if (!response) return;
    if (response.status !== true) { fail(response); return; }
    setEnabledOverride(false);
    setCode("");
    setView("status");
    notify.success({ key: "settings.twoFactorDisabled" });
  };

  const handleRegenerate = async (): Promise<void> => {
    if (loading || !code.trim()) return;
    setLoading(true);
    const response = await postTwoFactor("/auth/api/2fa/recovery-codes", { code });
    setLoading(false);
    if (!response) return;
    if (response.status !== true || !response.recoveryCodes) { fail(response); return; }
    setRecoveryCodes(response.recoveryCodes);
    setCode("");
    setView("recovery");
  };

  return (
    <div className="flex flex-col gap-3">
      {view === "status" && (
        <>
          <p className="text-sm text-common">
            {enabled
              ? translate({ key: "settings.twoFactorStatusOn" })
              : translate({ key: "settings.twoFactorStatusOff" })}
          </p>
          <div className="flex gap-2">
            {enabled ? (
              <>
                <button type="button" className={subtleButtonClass} onClick={() => { setCode(""); setView("disable"); }}>
                  {translate({ key: "settings.twoFactorDisable" })}
                </button>
                <button type="button" className={subtleButtonClass} onClick={() => { setCode(""); setView("regenerate"); }}>
                  {translate({ key: "settings.twoFactorRegenerate" })}
                </button>
              </>
            ) : (
              <button type="button" className={primaryButtonClass} onClick={() => void handleSetup()} disabled={loading}>
                {loading ? translate({ key: "login.loading" }) : translate({ key: "settings.twoFactorSetup" })}
              </button>
            )}
          </div>
        </>
      )}

      {view === "confirm" && (
        <>
          <p className="text-sm text-common">{translate({ key: "settings.twoFactorScanIntro" })}</p>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-xs">{translate({ key: "settings.twoFactorSecretLabel" })}</span>
            <button
              type="button"
              className="text-left font-mono text-sm break-all bg-container2 border border-container2-border rounded-md p-2 cursor-pointer hover:bg-container2-hover transition-colors"
              onClick={() => void copyText(secret)}
              title={otpauthUri}
            >
              {secret}
            </button>
            <button type="button" className="text-xs text-primary hover:text-primary-hover cursor-pointer bg-transparent border-none p-0 text-left" onClick={() => void copyText(otpauthUri)}>
              {translate({ key: "settings.twoFactorCopyUri" })}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="twoFactorEnableCode" className="font-medium text-xs">{translate({ key: "login.twoFactorCodeLabel" })}</label>
            <input
              id="twoFactorEnableCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => { setCode(e.target.value); }}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className={primaryButtonClass} onClick={() => void handleEnable()} disabled={loading}>
              {loading ? translate({ key: "login.loading" }) : translate({ key: "settings.twoFactorActivate" })}
            </button>
            <button type="button" className={subtleButtonClass} onClick={() => { setView("status"); }}>
              {translate({ key: "settings.twoFactorCancel" })}
            </button>
          </div>
        </>
      )}

      {view === "recovery" && (
        <>
          <p className="text-sm text-common">{translate({ key: "settings.twoFactorRecoveryIntro" })}</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm bg-container2 border border-container2-border rounded-md p-3">
            {recoveryCodes.map((recoveryCode) => (
              <span key={recoveryCode}>{recoveryCode}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={subtleButtonClass} onClick={() => void copyText(recoveryCodes.join("\n"))}>
              {translate({ key: "settings.twoFactorCopyCodes" })}
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => { setRecoveryCodes([]); setView("status"); }}>
              {translate({ key: "settings.twoFactorRecoveryDone" })}
            </button>
          </div>
        </>
      )}

      {(view === "disable" || view === "regenerate") && (
        <>
          <p className="text-sm text-common">
            {view === "disable"
              ? translate({ key: "settings.twoFactorDisableIntro" })
              : translate({ key: "settings.twoFactorRegenerateIntro" })}
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="twoFactorActionCode" className="font-medium text-xs">{translate({ key: "login.twoFactorCodeLabel" })}</label>
            <input
              id="twoFactorActionCode"
              type="text"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => { setCode(e.target.value); }}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void (view === "disable" ? handleDisable() : handleRegenerate())}
              disabled={loading}
            >
              {loading
                ? translate({ key: "login.loading" })
                : (view === "disable" ? translate({ key: "settings.twoFactorDisable" }) : translate({ key: "settings.twoFactorRegenerate" }))}
            </button>
            <button type="button" className={subtleButtonClass} onClick={() => { setView("status"); }}>
              {translate({ key: "settings.twoFactorCancel" })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
