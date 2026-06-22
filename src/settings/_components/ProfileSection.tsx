import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef } from "react";

import Avatar from "src/_components/Avatar";
import Dropdown, { type DropdownItem } from "src/_components/Dropdown";
import { useTranslator } from "@luckystack/core/client";
import { Section } from "./Section";

const THEMES = [
  { value: 'light', icon: faSun },
  { value: 'dark', icon: faMoon },
] as const;
type Theme = typeof THEMES[number]['value'];

const segmentedClass = (active: boolean) =>
  `flex-1 h-9 rounded-md text-sm font-medium border transition-colors cursor-pointer
   ${active
      ? 'bg-primary border-primary text-white'
      : 'bg-container2 border-container2-border text-common hover:bg-container2-hover hover:text-title'}`;

interface ProfileSectionProps {
  displayUrl: string;
  sessionName: string;
  sessionAvatarFallback: string;
  newName: string;
  newEmail: string;
  newTheme: Theme;
  emailChangePending: boolean;
  saving: boolean;
  languageItems: DropdownItem[];
  selectedLanguageItem: DropdownItem | undefined;
  sessionEmail: string;
  onNameChange: (name: string) => void;
  onEmailChange: (email: string) => void;
  onLanguageChange: (lang: string) => void;
  onThemeChange: (theme: Theme) => void;
  onSave: () => void;
  onAvatarFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRequestEmailChange: () => void;
}

export function ProfileSection({
  displayUrl,
  sessionName,
  sessionAvatarFallback,
  newName,
  newEmail,
  newTheme,
  emailChangePending,
  saving,
  languageItems,
  selectedLanguageItem,
  sessionEmail,
  onNameChange,
  onEmailChange,
  onLanguageChange,
  onThemeChange,
  onSave,
  onAvatarFile,
  onRequestEmailChange,
}: ProfileSectionProps) {
  const translate = useTranslator();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputClass = "w-full h-9 bg-container2 border border-container2-border rounded-md px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <Section title={translate({ key: 'settings.name' })}>
      <div className="flex gap-4 items-center">
        <div className="rounded-xl w-20 h-20 aspect-square select-none">
          <Avatar
            user={{ name: sessionName, avatar: displayUrl, avatarFallback: sessionAvatarFallback }}
            textSize="text-2xl"
          />
        </div>
        <div className="flex flex-col gap-2 flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onAvatarFile}
          />
          <button
            type="button"
            className="w-full h-9 px-3 bg-container2 border border-container2-border hover:bg-container2-hover rounded-md text-title text-sm font-medium transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            {translate({ key: 'settings.changeAvatar' })}
          </button>
          <div className="text-xs text-common">
            {translate({ key: 'settings.changeAvatarDescription' })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-name" className="text-xs font-medium">{translate({ key: 'settings.name' })}</label>
        <input id="settings-name" className={inputClass} value={newName} onChange={(e) => { onNameChange(e.target.value); }} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-email" className="text-xs font-medium">{translate({ key: 'settings.email' })}</label>
        <div className="flex gap-2">
          <input
            id="settings-email"
            type="email"
            className={inputClass}
            value={newEmail}
            onChange={(e) => { onEmailChange(e.target.value); }}
            disabled={emailChangePending}
          />
          <button
            type="button"
            onClick={onRequestEmailChange}
            disabled={emailChangePending || !newEmail.trim() || newEmail.trim().toLowerCase() === sessionEmail.toLowerCase()}
            className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            {translate({ key: 'settings.emailChange.button' })}
          </button>
        </div>
        <p className="text-xs text-common">{translate({ key: 'settings.emailChange.label' })}</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium">{translate({ key: 'settings.language.title' })}</div>
        <Dropdown
          items={languageItems}
          value={selectedLanguageItem}
          onChange={(item) => { onLanguageChange(item.value as string); }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium">{translate({ key: 'settings.theme.title' })}</div>
        <div className="flex w-full gap-2">
          {THEMES.map(({ value, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => { onThemeChange(value); }}
              className={`${segmentedClass(newTheme === value)} flex items-center justify-center gap-2`}
            >
              <FontAwesomeIcon icon={icon} />
              {translate({ key: `settings.theme.${value}` })}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={saving}
        className="w-full h-9 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-60"
        onClick={onSave}
      >
        {translate({ key: 'settings.saveChanges' })}
      </button>
    </Section>
  );
}
