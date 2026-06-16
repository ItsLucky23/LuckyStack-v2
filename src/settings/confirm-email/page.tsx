import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { loginPageUrl } from 'config';
import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';
import { apiRequest } from 'src/_sockets/apiRequest';

export const template = 'plain';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const translate = useTranslator();
  //? Start idle so link-prefetchers and mail-client preview panes cannot
  //? consume the one-shot token before the human clicks confirm.
  const [status, setStatus] = useState<Status>(token ? 'idle' : 'error');
  const [errorKey, setErrorKey] = useState<string>('auth.invalidToken');

  const handleConfirm = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    const response = await apiRequest({
      name: 'settings/confirmEmailChange',
      version: 'v1',
      data: { token },
    });
    if (response.status === 'success') {
      setStatus('success');
      notify.success({ key: 'settings.emailChange.confirmedTitle' });
    } else {
      setStatus('error');
      setErrorKey(response.errorCode);
      notify.error({ key: response.errorCode });
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="min-h-full w-full flex flex-col items-center justify-center p-4">
        <div className="p-6 bg-container1 border border-container1-border rounded-xl shadow-sm text-title flex flex-col gap-5 max-w-[360px] w-full">
          {status === 'idle' && (
            <>
              <h1 className="text-lg font-semibold">
                {translate({ key: 'settings.emailChange.confirmedTitle' })}
              </h1>
              <p className="text-xs text-common">
                {translate({ key: 'settings.emailChange.confirmPrompt' })}
              </p>
              <button
                type="button"
                onClick={() => { void handleConfirm(); }}
                className="h-9 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors cursor-pointer"
              >
                {translate({ key: 'settings.emailChange.confirmButton' })}
              </button>
            </>
          )}
          {status === 'loading' && (
            <p className="text-sm text-common text-center">
              {translate({ key: 'settings.emailChange.confirming' })}
            </p>
          )}
          {status === 'success' && (
            <>
              <h1 className="text-lg font-semibold">
                {translate({ key: 'settings.emailChange.confirmedTitle' })}
              </h1>
              <p className="text-xs text-common">
                {translate({ key: 'settings.emailChange.confirmedBody' })}
              </p>
              <Link
                to={loginPageUrl}
                className="h-9 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
              >
                {translate({ key: 'login.resetGoLogin' })}
              </Link>
            </>
          )}
          {status === 'error' && (
            <>
              <h1 className="text-lg font-semibold">
                {translate({ key: 'settings.emailChange.failedTitle' })}
              </h1>
              <p className="text-xs text-common">{translate({ key: errorKey })}</p>
              <Link
                to={loginPageUrl}
                className="h-9 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
              >
                {translate({ key: 'login.resetBackToLogin' })}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
