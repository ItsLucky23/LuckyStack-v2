import { useTranslator } from 'src/_functions/translator';

export const template = 'home';
export default function DashboardPage() {
  const translate = useTranslator();
  return (
    <div className='w-full h-full flex items-center justify-center bg-black font-semibold text-3xl'>
      <h1>{translate({ key: 'dashboard.title' })}</h1>
    </div>
  );
}