import { useRef, useState } from "react";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";
import { apiRequest } from "src/_sockets/apiRequest";
import { Section } from "./Section";

const inputClass = "w-full h-9 bg-container2 border border-container2-border rounded-md px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

export function PasswordSection() {
  const translate = useTranslator();
  const passwordCurrentRef = useRef<HTMLInputElement>(null);
  const passwordNewRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleChangePassword = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (passwordLoading) return;

    setPasswordLoading(true);
    const response = await apiRequest({
      name: 'settings/changePassword',
      version: 'v1',
      data: {
        currentPassword: passwordCurrentRef.current?.value ?? '',
        newPassword: passwordNewRef.current?.value ?? '',
        confirmPassword: passwordConfirmRef.current?.value ?? '',
      },
    });
    setPasswordLoading(false);

    if (response.status === 'success') {
      notify.success({ key: 'settings.passwordChanged' });
      if (passwordCurrentRef.current) passwordCurrentRef.current.value = '';
      if (passwordNewRef.current) passwordNewRef.current.value = '';
      if (passwordConfirmRef.current) passwordConfirmRef.current.value = '';
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <Section title={translate({ key: 'settings.passwordSection' })}>
      <form onSubmit={(e) => void handleChangePassword(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="current-pw">{translate({ key: 'settings.currentPassword' })}</label>
          <input id="current-pw" type="password" autoComplete="current-password" ref={passwordCurrentRef} className={inputClass} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="new-pw">{translate({ key: 'settings.newPassword' })}</label>
          <input id="new-pw" type="password" autoComplete="new-password" ref={passwordNewRef} className={inputClass} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" htmlFor="confirm-pw">{translate({ key: 'settings.confirmNewPassword' })}</label>
          <input id="confirm-pw" type="password" autoComplete="new-password" ref={passwordConfirmRef} className={inputClass} required />
        </div>
        <button
          type="submit"
          disabled={passwordLoading}
          className="self-start h-9 px-4 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-60"
        >
          {translate({ key: 'settings.changePassword' })}
        </button>
      </form>
    </Section>
  );
}
