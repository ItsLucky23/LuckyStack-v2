import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";
import { apiRequest } from "src/_sockets/apiRequest";
import { Section } from "./Section";

interface ActiveSession {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}

interface SessionsSectionProps {
  activeSessions: ActiveSession[];
  onRefresh: () => void;
}

export function SessionsSection({ activeSessions, onRefresh }: SessionsSectionProps) {
  const translate = useTranslator();

  const handleRevokeSession = async (handle: string) => {
    const response = await apiRequest({
      name: 'settings/revokeSession',
      version: 'v1',
      data: { handle },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.sessionRevoked' });
      onRefresh();
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <Section title={translate({ key: 'settings.sessionsSection' })}>
      {activeSessions.length === 0
        ? <div className="text-sm text-common">{translate({ key: 'settings.sessionsEmpty' })}</div>
        : (
          <ul className="flex flex-col gap-2">
            {activeSessions.map((s) => (
              <li key={s.handle} className="flex items-center gap-3 p-3 rounded-md border border-container1-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-title">
                    {s.isCurrent ? translate({ key: 'settings.currentSession' }) : `…${s.handle.slice(-8)}`}
                  </div>
                  {s.expiresInSeconds !== null && (
                    <div className="text-xs text-common">
                      {translate({ key: 'settings.sessionExpiresIn', params: [{ key: 'hours', value: String(Math.round(s.expiresInSeconds / 3600)) }] })}
                    </div>
                  )}
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeSession(s.handle)}
                    className="h-9 px-3 rounded-md bg-container2 hover:bg-container2-hover border border-container2-border text-title text-sm font-medium transition-colors cursor-pointer"
                  >
                    {translate({ key: 'settings.revokeSession' })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}
