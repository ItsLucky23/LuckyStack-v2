import { getProjectConfig, type SOCKETSTATUS } from '@luckystack/core/client';

export interface SocketStatusIndicatorProps {
  status: SOCKETSTATUS;
  reconnectAttempt?: number;
  /** Optional translated label prefix, e.g. "Socket status:". */
  label?: string;
}

const STATUS_TINT: Record<SOCKETSTATUS, string> = {
  STARTUP: 'bg-warning',
  CONNECTED: 'bg-correct',
  DISCONNECTED: 'bg-wrong',
  RECONNECTING: 'bg-warning',
  AFK: 'bg-warning',
};

//? Self-gates on `getProjectConfig().socketStatusIndicator` so callers can
//? render unconditionally — flipping the config flag is the only switch.
export function SocketStatusIndicator({ status, reconnectAttempt, label }: SocketStatusIndicatorProps) {
  if (!getProjectConfig().socketStatusIndicator) return null;

  const tint = STATUS_TINT[status] ?? 'bg-wrong';
  const attemptSuffix = status === 'RECONNECTING' && reconnectAttempt !== undefined
    ? ` (attempt ${String(reconnectAttempt)})`
    : '';

  return (
    <div className={`absolute top-2 right-2 z-50 ${tint} text-white px-2 py-1 rounded-md text-xs font-bold pointer-events-none`}>
      {label ? `${label} ` : ''}{status}{attemptSuffix}
    </div>
  );
}
