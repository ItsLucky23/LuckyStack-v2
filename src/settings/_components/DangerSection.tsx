import { faRightFromBracket, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef } from "react";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";
import { menuHandler } from "src/_functions/menuHandler";
import { apiRequest } from "src/_sockets/apiRequest";
import { Section } from "./Section";

const inputClass = "w-full h-9 bg-container2 border border-container2-border rounded-md px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

interface DangerSectionProps {
  isCredentials: boolean;
}

export function DangerSection({ isCredentials }: DangerSectionProps) {
  const translate = useTranslator();
  const deletePasswordRef = useRef<HTMLInputElement>(null);

  const handleSignOutEverywhere = async () => {
    const confirmed = await menuHandler.confirm({
      title: translate({ key: 'settings.signOutEverywhere' }),
      content: translate({ key: 'settings.signOutEverywhereConfirm' }),
    });
    if (!confirmed) return;

    const response = await apiRequest({
      name: 'settings/signOutEverywhere',
      version: 'v1',
      data: {},
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.signOutEverywhereDone' });
      // Server will close our socket; redirect happens via session update
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = await menuHandler.confirm({
      title: translate({ key: 'settings.deleteAccount' }),
      content: translate({ key: 'settings.deleteAccountConfirm' }),
      input: 'DELETE',
    });
    if (!confirmed) return;

    //? Credentials accounts must re-enter their password — the server
    //? (`deleteAccount_v1`) rejects with `login.wrongPassword` otherwise.
    //? OAuth-only accounts have no hash, so the field is hidden and we send
    //? `undefined` (server skips the check).
    const password = deletePasswordRef.current?.value ?? '';

    const response = await apiRequest({
      name: 'settings/deleteAccount',
      version: 'v1',
      data: { confirmation: 'DELETE', password: isCredentials ? password : undefined },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.deleteAccountDone' });
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <Section title={translate({ key: 'settings.dangerSection' })}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSignOutEverywhere()}
          className="h-9 px-4 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
        >
          <FontAwesomeIcon icon={faRightFromBracket} />
          {translate({ key: 'settings.signOutEverywhere' })}
        </button>
        <button
          type="button"
          onClick={() => void handleDeleteAccount()}
          className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
        >
          <FontAwesomeIcon icon={faTrash} />
          {translate({ key: 'settings.deleteAccount' })}
        </button>
      </div>
      {isCredentials && (
        <div className="flex flex-col gap-1">
          <label htmlFor="delete-pw" className="text-xs font-medium">{translate({ key: 'settings.currentPassword' })}</label>
          <input id="delete-pw" type="password" autoComplete="current-password" ref={deletePasswordRef} className={inputClass} />
        </div>
      )}
      <p className="text-xs text-common flex items-center gap-2">
        <FontAwesomeIcon icon={faTriangleExclamation} />
        {translate({ key: 'settings.deleteAccountConfirm' })}
      </p>
    </Section>
  );
}
