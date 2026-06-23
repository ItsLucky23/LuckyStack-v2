import { useCallback, useEffect, useMemo, useState } from "react";

import {
  i18nNotify as notify,
  useSession,
  useTheme,
  useTranslator,
  useUpdateLanguage,
} from "@luckystack/core/client";
import type { PageMiddleware } from "@luckystack/core/client";
import { apiRequest } from "src/_sockets/apiRequest";

import { backendUrl, SessionLayout } from "../../config";
import { DangerSection } from "./_components/DangerSection";
import { PasswordSection } from "./_components/PasswordSection";
import { PreferencesSection } from "./_components/PreferencesSection";
import { ProfileSection } from "./_components/ProfileSection";
import { SessionsSection } from "./_components/SessionsSection";

const stripAvatarVersion = (url: string) => url.replace(/[?&]v=\d+/, '');

const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];

type Theme = 'light' | 'dark';

interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
}

interface ActiveSession {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}

export const template = 'dashboard';

//? Per-page route guard. `/settings` shows the user's avatar, language,
//? theme, and active sessions — all of which require a logged-in session.
//? Logged-out visitors bounce to `/login`.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

export default function Home() {
  const { session } = useSession<SessionLayout>();
  const { setTheme: updateTheme } = useTheme();
  const setLanguage = useUpdateLanguage();
  const translate = useTranslator();

  const [newLanguage, setNewLanguage] = useState<Language>((session?.language ?? 'en'));
  const [newName, setNewName] = useState<string>(session?.name ?? '');
  const [newTheme, setNewTheme] = useState<Theme>(session?.theme ?? 'dark');
  const [newEmail, setNewEmail] = useState<string>(session?.email ?? '');
  const [emailChangePending, setEmailChangePending] = useState<boolean>(false);
  const [emailChangePassword, setEmailChangePassword] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(
    (session?.preferences as UserPreferences | undefined) ?? {},
  );

  //? Email change is a separate flow from `saveProfile` — it routes through a
  //? confirmation email + token rather than being applied directly. We POST
  //? to `settings/requestEmailChange`, and the actual write happens on the
  //? user clicking the link sent to the new address.
  const handleRequestEmailChange = useCallback(async () => {
    if (!session) return;
    const trimmed = newEmail.trim();
    if (!trimmed || trimmed.toLowerCase() === session.email.toLowerCase()) return;

    //? Credentials accounts must confirm their current password — the route
    //? rejects the change without it. OAuth accounts have no password; the field
    //? isn't shown and the empty value is ignored server-side.
    const isCredentials = session.provider === 'credentials';
    if (isCredentials && !emailChangePassword) {
      notify.error({ key: 'settings.emailChange.currentPasswordRequired' });
      return;
    }

    setEmailChangePending(true);
    const response = await apiRequest({
      name: 'settings/requestEmailChange',
      version: 'v1',
      data: { newEmail: trimmed, currentPassword: emailChangePassword },
    });
    setEmailChangePending(false);

    if (response.status === 'success') {
      setEmailChangePassword('');
      notify.info({ key: 'settings.emailChange.checkInbox' });
    } else {
      notify.error({ key: response.errorCode });
    }
  }, [newEmail, session, emailChangePassword]);

  const saveProfile = useCallback(async (newAvatar?: string) => {
    if (!session || saving) return;

    const avatarChanged = newAvatar
      ? stripAvatarVersion(newAvatar) !== stripAvatarVersion(session.avatar)
      : false;
    const avatarToSave = avatarChanged ? newAvatar : undefined;

    if (
      newLanguage === session.language
      && newName === session.name
      && newTheme === session.theme
      && !newAvatar
    ) {
      notify.info({ key: 'settings.noChangesMade' });
      return;
    }

    setSaving(true);
    const response = await apiRequest({
      name: "settings/updateUser",
      version: 'v1',
      data: {
        language: newLanguage === session.language ? undefined : newLanguage,
        avatar: avatarToSave,
        name: newName === session.name ? undefined : newName,
        theme: newTheme === session.theme ? undefined : newTheme,
      },
    });
    setSaving(false);
    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' });
    } else {
      notify.error({ key: 'settings.failedUpdateUser' });
    }
  }, [newLanguage, newName, newTheme, saving, session]);

  const handleAvatarFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error({ key: 'settings.sizeToLarge' });
      return;
    }

    notify.info({ key: 'settings.loadingImg' });
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      //? data-URIs cannot have query strings — the cache-buster is only meaningful
      //? for HTTP URLs. The server stores the user's id as the filename, so the
      //? session-update after save already carries a fresh ?v= via updateSession.
      if (typeof result === 'string') {
        void saveProfile(result);
      }
    });
    reader.readAsDataURL(file);
  }, [saveProfile]);

  const refreshSessions = useCallback(async () => {
    const response = await apiRequest({
      name: 'settings/listSessions',
      version: 'v1',
      data: {},
    });
    if (response.status === 'success') {
      setActiveSessions(response.result.sessions);
    }
  }, []);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const languageItems = useMemo(() => LANGUAGES.map((lang) => ({
    id: lang,
    value: lang,
    placeholder: translate({ key: `settings.language.${lang}` }),
  })), [translate]);
  const selectedLanguageItem = languageItems.find((item) => item.id === newLanguage);

  const togglePreference = async (key: keyof UserPreferences) => {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    const response = await apiRequest({
      name: 'settings/updatePreferences',
      version: 'v1',
      data: { preferences: next },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.preferencesSaved' });
    } else {
      // Roll back on error
      setPreferences(preferences);
      notify.error({ key: response.errorCode });
    }
  };

  if (!session) return null;

  const displayUrl = session.avatar.startsWith('http')
    ? session.avatar
    : `${backendUrl}/uploads/${session.avatar}`;

  const handleThemeChange = (theme: Theme) => {
    setNewTheme(theme);
    updateTheme(theme);
  };

  const handleLanguageChange = (lang: string) => {
    setNewLanguage(lang as Language);
    setLanguage(lang);
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">

        <ProfileSection
          displayUrl={displayUrl}
          sessionName={session.name}
          sessionAvatarFallback={session.avatarFallback}
          newName={newName}
          newEmail={newEmail}
          newTheme={newTheme}
          emailChangePending={emailChangePending}
          saving={saving}
          languageItems={languageItems}
          selectedLanguageItem={selectedLanguageItem}
          sessionEmail={session.email}
          requiresEmailPassword={session.provider === 'credentials'}
          emailChangePassword={emailChangePassword}
          onNameChange={setNewName}
          onEmailChange={setNewEmail}
          onEmailChangePasswordChange={setEmailChangePassword}
          onLanguageChange={handleLanguageChange}
          onThemeChange={handleThemeChange}
          onSave={() => { void saveProfile(); }}
          onAvatarFile={handleAvatarFile}
          onRequestEmailChange={() => { void handleRequestEmailChange(); }}
        />

        {/* Password change — only relevant for credentials accounts */}
        {session.provider === 'credentials' && <PasswordSection />}

        <SessionsSection
          activeSessions={activeSessions}
          onRefresh={() => { void refreshSessions(); }}
        />

        <PreferencesSection
          preferences={preferences}
          onToggle={(key) => { void togglePreference(key); }}
        />

        <DangerSection isCredentials={session.provider === 'credentials'} />

      </div>
    </div>
  );
}
