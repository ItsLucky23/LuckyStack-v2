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
  /**
   * Corner to anchor the floating badge to. Defaults to `'top-right'`. Use this
   * when the default corner collides with app chrome (e.g. a top-right menu).
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /**
   * Extra classes appended AFTER the defaults, so they win on conflict —
   * override size, shape, z-index, or make it clickable (`pointer-events-auto`).
   */
  className?: string;
}

const POSITION_CLASS: Record<NonNullable<SocketStatusIndicatorProps['position']>, string> = {
  'top-left': 'top-2 left-2',
  'top-right': 'top-2 right-2',
  'bottom-left': 'bottom-2 left-2',
  'bottom-right': 'bottom-2 right-2',
};

const STATUS_TINT: Record<SOCKETSTATUS, 'bg-warning' | 'bg-correct' | 'bg-wrong'> = {
  STARTUP: 'bg-warning',
  CONNECTED: 'bg-correct',
  DISCONNECTED: 'bg-wrong',
  RECONNECTING: 'bg-warning',
  AFK: 'bg-warning',
};

//? On-tint text token from the theme, so the indicator follows the project
//? palette instead of a hardcoded `text-white`. Defined in `src/index.css`'s
//? @theme. Single constant until the per-tint text colors actually diverge.
const ON_TINT_TEXT = 'text-common-primary';

//? Self-gates on `getProjectConfig().socketStatusIndicator` so callers can
//? render unconditionally — flipping the config flag is the only switch.
export function SocketStatusIndicator({ status, reconnectAttempt, label, formatStatus, position = 'top-right', className }: SocketStatusIndicatorProps) {
  if (!getProjectConfig().socketStatusIndicator) return null;

  //? `STATUS_TINT` is total over `SOCKETSTATUS`, so the lookup is always defined.
  const tint = STATUS_TINT[status];
  const onTint = ON_TINT_TEXT;
  const corner = POSITION_CLASS[position];
  const statusText = formatStatus
    ? formatStatus(status, reconnectAttempt)
    : `${status}${status === 'RECONNECTING' && reconnectAttempt !== undefined ? ` (attempt ${String(reconnectAttempt)})` : ''}`;

  return (
    <div className={`absolute ${corner} z-50 ${tint} ${onTint} px-2 py-1 rounded-md text-xs font-bold pointer-events-none ${className ?? ''}`}>
      {label ? `${label} ` : ''}{statusText}
    </div>
  );
}
