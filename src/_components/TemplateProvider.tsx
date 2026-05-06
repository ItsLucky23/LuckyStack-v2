import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { SocketStatusIndicator } from '@luckystack/presence/client';

import { defaultTheme } from "config";
import Middleware from 'src/_components/Middleware';
import Navbar from "src/_components/Navbar";
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

import { useSession } from '../_providers/SessionProvider';

import ThemeToggler from './ThemeToggler';
import { useTranslator } from '../_functions/translator';

export type Template = 'dashboard' | 'plain';

const Templates = {
  dashboard: DashboardTemplate,
  plain: PlainTemplate,
} satisfies Record<Template, React.ComponentType<{ children: React.ReactNode }>>;

function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-background text-title">
      <Navbar />
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Middleware>
          {children}
        </Middleware>
      </div>
    </div>
  );
}

function PlainTemplate({ children }: { children: React.ReactNode }) {
  const { updateTheme } = ThemeToggler();
  const reactLocation = useLocation();

  useEffect(() => {
    updateTheme(defaultTheme);
    document.documentElement.classList.toggle("dark", defaultTheme === "dark");
  }, [updateTheme, reactLocation]);

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

  const { session } = useSession();
  const reactLocation = useLocation();
  const { updateTheme } = ThemeToggler();
  const { socketStatus } = useSocketStatus();
  const translate = useTranslator();

  useEffect(() => {
    if (session?.theme) {
      updateTheme(session.theme);
      document.documentElement.classList.toggle("dark", session.theme === "dark");
    }
  }, [session, updateTheme, reactLocation]);

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