import { useTranslator } from "@luckystack/core/client";
import { Section } from "./Section";
import { PreferenceToggle } from "./PreferenceToggle";

interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
}

interface PreferencesSectionProps {
  preferences: UserPreferences;
  onToggle: (key: keyof UserPreferences) => void;
}

export function PreferencesSection({ preferences, onToggle }: PreferencesSectionProps) {
  const translate = useTranslator();

  return (
    <Section title={translate({ key: 'settings.preferencesSection' })}>
      <PreferenceToggle
        label={translate({ key: 'settings.prefNotifySignIn' })}
        checked={preferences.notifyOnNewSignIn ?? false}
        onToggle={() => { onToggle('notifyOnNewSignIn'); }}
      />
      <PreferenceToggle
        label={translate({ key: 'settings.prefNotifyPassword' })}
        checked={preferences.notifyOnPasswordChange ?? false}
        onToggle={() => { onToggle('notifyOnPasswordChange'); }}
      />
    </Section>
  );
}
