import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { SocketStatusIndicator } from '@luckystack/presence/client';
import {
  Middleware,
  useSession,
  useTheme,
  useTranslator,
} from '@luckystack/core/client';

import { defaultTheme, SessionLayout } from "config";
import Navbar from "src/_components/Navbar";
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

export type Template = 'dashboard' | 'plain';

const Templates = {
  dashboard: DashboardTemplate,
  plain: PlainTemplate,
} satisfies Record<Template, React.ComponentType<{ children: React.ReactNode }>>;

function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-background text-title">
      <Navbar />
      {/* Reserve the folded rail's 14px so the content never reflows when the
          sidebar toggles — the rail is an absolute overlay (not in flow), so the
          expand/collapse only animates the overlay width, never the content. */}
      <div className="flex-1 min-w-0 h-full overflow-hidden md:pl-14">
        <Middleware>
          {children}
        </Middleware>
      </div>
    </div>
  );
}

function PlainTemplate({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const reactLocation = useLocation();

  useEffect(() => {
    setTheme(defaultTheme);
  }, [setTheme, reactLocation]);

  return (
    <div className="w-full h-full">
      {children}
    </div>
  );
}

export default function TemplateProvider({
  children,
  initialTemplate,
}: {
  children: React.ReactNode;
  initialTemplate: Template;
}) {
  const [template] = useState<Template>(initialTemplate);
  const TemplateComponent = Templates[template];

  const { session } = useSession<SessionLayout>();
  const reactLocation = useLocation();
  const { setTheme } = useTheme();
  const { socketStatus } = useSocketStatus();
  const translate = useTranslator();

  useEffect(() => {
    if (session?.theme === 'light' || session?.theme === 'dark') {
      setTheme(session.theme);
    }
  }, [session?.theme, setTheme, reactLocation]);

  return (
    <div className='w-full h-full relative'>
      <SocketStatusIndicator
        status={socketStatus.self.status}
        reconnectAttempt={socketStatus.self.reconnectAttempt}
        label={translate({ key: 'template.socketStatus' })}
      />
      <TemplateComponent>{children}</TemplateComponent>
    </div>
  );
}
