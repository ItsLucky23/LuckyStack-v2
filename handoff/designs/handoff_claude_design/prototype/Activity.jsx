/* Workspaces UI kit — activity / event-log screen. */
const { useState: useStateAct } = React;

const EVENT_META = {
  command: { icon: 'terminal',          color: 'var(--primary)' },
  file:    { icon: 'file-pen',          color: 'var(--secondary)' },
  message: { icon: 'comment-dots',      color: 'var(--muted)' },
  status:  { icon: 'circle-half-stroke',color: 'var(--warning)' },
  mr:      { icon: 'code-merge',        color: 'var(--correct)' },
  comment: { icon: 'comment',           color: 'var(--muted)' },
};

function EventRow({ e, members, hideTicket, onOpenTicket }) {
  const m = EVENT_META[e.type] ?? EVENT_META.message;
  const isAI = e.actor === 'ai';
  const isMr = e.actor === 'mr';
  const person = members[e.actor];
  return (
    <div className="ws-evt">
      <span className="ws-evt-time">{e.time}</span>
      <span className="ws-evt-actor">
        {isAI ? <span className="ws-evt-bot"><Icon name="robot" /></span>
          : isMr ? <span className="ws-evt-mr"><Icon name="code-merge" /></span>
          : person ? <Avatar user={person} size={22} /> : <span className="ws-evt-bot"><Icon name="user" /></span>}
      </span>
      {!hideTicket && (
        <button type="button" className="ws-evt-tk" onClick={() => onOpenTicket?.(e.ticket)}>{e.ticket}</button>
      )}
      <span className="ws-evt-type" style={{ color: m.color }}><Icon name={m.icon} /> {e.type}</span>
      <span className="ws-evt-text">{e.text}</span>
    </div>
  );
}

function ActivityScreen({ ctx }) {
  const [tab, setTab] = useStateAct('live');
  const [live, setLive] = useStateAct(true);
  const [rewind, setRewind] = useStateAct(false);
  const [open, setOpen] = useStateAct(null);
  return (
    <div className="ws-screen">
      <ScreenHead title="Activity">
        <Dropdown label="All tickets" icon="filter" items={[{ id: 'all', label: 'All tickets' }, { id: 'mine', label: 'My tickets' }]} />
        <button type="button" className={'ws-live-btn' + (live && !rewind ? ' is-on' : '')} onClick={() => { setLive(l => !l); setRewind(false); }}>
          <span className="ws-live-dot ws-pulse" /> {rewind ? 'Rewinding' : live ? 'Live' : 'Paused'}
        </button>
        <Button variant="secondary" icon="rotate-left" onClick={() => setRewind(r => !r)}>{ctx.isMobile ? '' : 'Rewind'}</Button>
      </ScreenHead>
      <Tabs tabs={[{ id: 'live', label: 'Live' }, { id: 'audit', label: 'Audit' }]} active={tab} onChange={setTab} />
      {!live && !rewind && <div className="ws-banner is-warn ws-banner-thin" style={{ margin: '10px 22px 0' }}><Icon name="plug-circle-exclamation" /><div>Reconnecting… will catch up.</div></div>}
      {rewind && (
        <div className="ws-rewind">
          <Icon name="clock-rotate-left" /><input type="range" min="0" max="100" defaultValue="60" className="ws-rewind-range" /><span className="ws-rewind-t">14:21 · 11 min ago</span>
          <button type="button" className="ws-txtbtn" onClick={() => { setRewind(false); setLive(true); }}>Back to live</button>
        </div>
      )}
      <div className="ws-evt-list">
        {window.WS_EVENTS.map((e, i) => (
          <div key={i}>
            <div onClick={() => setOpen(open === i ? null : i)}><EventRow e={e} members={ctx.members} onOpenTicket={ctx.openTicket} /></div>
            {open === i && (e.type === 'file' || e.type === 'command') && (
              <pre className="ws-evt-expand">{e.type === 'file' ? '@@ -14,7 +14,9 @@\n-  const status = avatarStatuses[key];\n+  const status = avatarStatuses[statusKey];\n+  const showFallback = !user.avatar || status === \'fallback\';' : '$ npm test\n  ✓ 18 passing\n  ✗ 2 failing · Avatar.test.tsx'}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { EventRow, ActivityScreen, EVENT_META });
