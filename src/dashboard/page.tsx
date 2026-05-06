import {
  faBolt,
  faChartLine,
  faCircleCheck,
  faCircleExclamation,
  faClock,
  faFlask,
  faGear,
  faRightFromBracket,
  faTriangleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback } from 'react';

import Avatar from 'src/_components/Avatar';
import useRouter from 'src/_components/Router';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { useSocketStatus } from 'src/_providers/socketStatusProvider';
import { apiRequest } from 'src/_sockets/apiRequest';

export const template = 'dashboard';

const RELATIVE_THRESHOLDS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

function formatRelativeTime(date: Date): string {
  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, seconds } of RELATIVE_THRESHOLDS) {
    if (Math.abs(diffSeconds) >= seconds || unit === 'second') {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(0, 'second');
}

interface StatCardProps {
  icon: IconDefinition;
  label: string;
  value: string;
  delta?: string;
  tone?: 'neutral' | 'positive' | 'negative';
}

function StatCard({ icon, label, value, delta, tone = 'neutral' }: StatCardProps) {
  const deltaClass = tone === 'positive'
    ? 'text-correct'
    : (tone === 'negative' ? 'text-wrong' : 'text-common');
  return (
    <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-common text-xs font-medium uppercase tracking-wide">
        <FontAwesomeIcon icon={icon} className="text-sm" />
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-title">{value}</div>
        {delta && <div className={`text-xs font-medium ${deltaClass}`}>{delta}</div>}
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: IconDefinition;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'destructive';
}

function QuickAction({ icon, label, onClick, tone = 'neutral' }: QuickActionProps) {
  const toneClass = tone === 'destructive'
    ? 'bg-container2 border-container2-border hover:bg-wrong hover:text-white hover:border-wrong'
    : 'bg-container2 border-container2-border hover:bg-container2-hover text-title';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 h-9 px-4 rounded-md border text-sm font-medium transition-colors cursor-pointer ${toneClass}`}
    >
      <FontAwesomeIcon icon={icon} />
      {label}
    </button>
  );
}

export default function DashboardPage() {
  const translate = useTranslator();
  const { session } = useSession();
  const router = useRouter();
  const { socketStatus } = useSocketStatus();

  const handleNavigate = useCallback((path: string) => { void router(path); }, [router]);
  const handleLogout = useCallback(() => {
    void apiRequest({ name: 'system/logout', version: 'v1' });
  }, []);

  const previousLogin = session?.previousLogin ? new Date(session.previousLogin) : null;
  const lastSignInLabel = previousLogin
    ? translate({ key: 'dashboard.lastSignIn', params: [{ key: 'when', value: formatRelativeTime(previousLogin) }] })
    : translate({ key: 'dashboard.lastSignInFirst' });

  const status = socketStatus.self.status;
  const statusTone = status === 'CONNECTED'
    ? 'positive'
    : ((status === 'RECONNECTING' || status === 'STARTUP') ? 'neutral' : 'negative');
  const statusIcon = status === 'CONNECTED'
    ? faCircleCheck
    : (status === 'DISCONNECTED' ? faCircleExclamation : faTriangleExclamation);
  const statusLabelKey = status === 'CONNECTED'
    ? 'dashboard.statusConnected'
    : ((status === 'RECONNECTING' || status === 'STARTUP')
      ? 'dashboard.statusReconnecting'
      : 'dashboard.statusDisconnected');
  const statusToneClass = statusTone === 'positive'
    ? 'text-correct'
    : (statusTone === 'neutral' ? 'text-warning' : 'text-wrong');

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6 flex flex-col gap-5">

        {/* Welcome card */}
        <section className="bg-container1 border border-container1-border rounded-xl p-5 flex items-center gap-4">
          {session && (
            <div className="w-12 h-12 flex-shrink-0">
              <Avatar user={session} textSize="text-lg" />
            </div>
          )}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-title line-clamp-1">
              {translate({ key: 'dashboard.welcome', params: [{ key: 'name', value: session?.name ?? '' }] })}
            </h1>
            <p className="text-sm text-common">
              {translate({ key: 'dashboard.welcomeSubtitle' })}
            </p>
            <p className="text-xs text-common">
              {lastSignInLabel}
            </p>
          </div>
          <div className={`hidden sm:flex items-center gap-2 text-xs font-medium ${statusToneClass}`}>
            <FontAwesomeIcon icon={statusIcon} />
            {translate({ key: statusLabelKey })}
          </div>
        </section>

        {/* Stats row — placeholder values, swap with real data */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={faChartLine} label={translate({ key: 'dashboard.statsApiCalls' })} value="1,284" delta="+12%" tone="positive" />
          <StatCard icon={faUsers} label={translate({ key: 'dashboard.statsActiveSessions' })} value="3" />
          <StatCard icon={faTriangleExclamation} label={translate({ key: 'dashboard.statsRecentErrors' })} value="0" tone="positive" />
          <StatCard icon={faClock} label={translate({ key: 'dashboard.statsUptime' })} value="99.9%" tone="positive" />
        </section>

        {/* Quick actions */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-common uppercase tracking-wide">
            {translate({ key: 'dashboard.quickActions' })}
          </h2>
          <div className="flex flex-wrap gap-2">
            <QuickAction icon={faGear} label={translate({ key: 'dashboard.openSettings' })} onClick={() => { handleNavigate('/settings'); }} />
            <QuickAction icon={faFlask} label={translate({ key: 'dashboard.openPlayground' })} onClick={() => { handleNavigate('/playground'); }} />
            <QuickAction icon={faRightFromBracket} label={translate({ key: 'dashboard.signOut' })} onClick={handleLogout} tone="destructive" />
          </div>
        </section>

        {/* Recent activity (empty state placeholder) */}
        <section className="bg-container1 border border-container1-border rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-title flex items-center gap-2">
            <FontAwesomeIcon icon={faBolt} className="text-common" />
            {translate({ key: 'dashboard.recentActivity' })}
          </h2>
          <div className="text-sm text-common py-6 text-center">
            {translate({ key: 'dashboard.recentActivityEmpty' })}
          </div>
        </section>

      </div>
    </div>
  );
}
