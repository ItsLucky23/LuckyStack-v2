import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from 'config';

//? Per-page route guard. Replaces the central switch case for `/admin` in
//? `src/_functions/middlewareHandler.ts`. Logged-out users → `/login`;
//? logged-in non-admins → toast + `navigate(-1)` (returning nothing from
//? the middleware triggers the history-back behavior).
export const template = 'dashboard';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  if (session.admin) return { success: true };
  notify.error({ key: 'middleware.notAdmin' });
  return;
};

export default function Home() {
  const translate = useTranslator();
  return (
    <div className='flex items-center justify-center text-4xl font-semibold w-full h-full'>
      {translate({ key: 'admin.title' })}
    </div>
  )
}