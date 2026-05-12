import { getProjectConfig, type SOCKETSTATUS } from '@luckystack/core/client';

export interface SocketStatusIndicatorProps {
  status: SOCKETSTATUS;
  reconnectAttempt?: number;
  /**
   * Optional translated label prefix, e.g. "Socket status:". Use your project
   * translator to produce a localized string and pass it here.
   */
  label?: string;
  /**
   * Optional formatter that receives the raw status + reconnect attempt and
   * returns the localized text to render. Wire your project translator here:
   * `formatStatus={(s) => translate({ key: 'presence.status.' + s.toLowerCase() })}`.
   * If omitted, the raw status is rendered (English).
   */
  formatStatus?: (status: SOCKETSTATUS, reconnectAttempt: number | undefined) => string;
}

const STATUS_TINT: Record<SOCKETSTATUS, 'bg-warning' | 'bg-correct' | 'bg-wrong'> = {
  STARTUP: 'bg-warning',
  CONNECTED: 'bg-correct',
  DISCONNECTED: 'bg-wrong',
  RECONNECTING: 'bg-warning',
  AFK: 'bg-warning',
};

//? Pair each background tint with the on-tint text token from the theme,
//? so the indicator follows the project palette instead of using a
//? hardcoded `text-white`. Tokens are defined in `src/index.css`'s @theme.
const ON_TINT_TEXT: Record<typeof STATUS_TINT[SOCKETSTATUS], string> = {
  'bg-warning': 'text-common-primary',
  'bg-correct': 'text-common-primary',
  'bg-wrong': 'text-common-primary',
};

//? Self-gates on `getProjectConfig().socketStatusIndicator` so callers can
//? render unconditionally — flipping the config flag is the only switch.
export function SocketStatusIndicator({ status, reconnectAttempt, label, formatStatus }: SocketStatusIndicatorProps) {
  if (!getProjectConfig().socketStatusIndicator) return null;

  const tint = STATUS_TINT[status] ?? 'bg-wrong';
  const onTint = ON_TINT_TEXT[tint] ?? 'text-common-primary';
  const statusText = formatStatus
    ? formatStatus(status, reconnectAttempt)
    : `${status}${status === 'RECONNECTING' && reconnectAttempt !== undefined ? ` (attempt ${String(reconnectAttempt)})` : ''}`;

  return (
    <div className={`absolute top-2 right-2 z-50 ${tint} ${onTint} px-2 py-1 rounded-md text-xs font-bold pointer-events-none`}>
      {label ? `${label} ` : ''}{statusText}
    </div>
  );
}
