/* Workspaces UI kit — app shell: nav rail, top bar, tab/session bar, AI panel, mobile chrome. */
const { useState: useStateShell } = React;

const NAV_ITEMS = [
  { id: 'board',     icon: 'table-columns',  label: 'Board' },
  { id: 'backlog',   icon: 'list-check',     label: 'Backlog' },
  { id: 'terminals', icon: 'terminal',       label: 'Terminals' },
  { id: 'activity',  icon: 'wave-square',    label: 'Activity' },
  { id: 'sources',   icon: 'book-open',      label: 'Sources' },
  { id: 'pipeline',  icon: 'diagram-project',label: 'Pipeline' },
  { id: 'usage',     icon: 'chart-column',   label: 'Usage' },
];
const NAV_BOTTOM = [
  { id: 'ai',       icon: 'robot', label: 'Workspace-AI' },
  { id: 'settings', icon: 'gear',  label: 'Settings' },
];

function NavRail({ expanded, setExpanded, active, onNavigate, me, aiCount }) {
  const item = (it) => {
    const badge = it.id === 'ai' ? aiCount : it.badge;
    return (
      <button key={it.id} type="button"
        className={'ws-nav-item' + (active === it.id ? ' is-active' : '')}
        onClick={() => onNavigate(it.id)}>
        <span className="ws-nav-ic"><Icon name={it.icon} />{badge ? <span className="ws-nav-badge">{badge}</span> : null}</span>
        {expanded && <span className="ws-nav-lab">{it.label}</span>}
        {!expanded && <span className="ws-nav-tip">{it.label}</span>}
      </button>
    );
  };
  return (
    <nav className={'ws-rail' + (expanded ? ' is-expanded' : '')}>
      <div className="ws-rail-top">
        <div className="ws-rail-brand">
          <img src="assets/logo-mark.svg" alt="" className="ws-rail-logo" />
          {expanded && <span className="ws-rail-name">Workspaces</span>}
        </div>
        <button type="button" className="ws-rail-fold" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}>
          <Icon name={expanded ? 'angle-left' : 'angle-right'} />
        </button>
      </div>
      <div className="ws-rail-items">{NAV_ITEMS.map(item)}</div>
      <div className="ws-rail-bottom">
        {NAV_BOTTOM.map(item)}
        <button type="button" className="ws-nav-item" onClick={() => onNavigate('settings')}>
          <span className="ws-nav-ic"><Avatar user={me} size={22} /></span>
          {expanded && <span className="ws-nav-lab">{me.name}</span>}
          {!expanded && <span className="ws-nav-tip">{me.name} · settings</span>}
        </button>
      </div>
    </nav>
  );
}

function TopBar({ me, presence, theme, setTheme, onHamburger, onCmdK, onCreateWorkspace, onManageMembers, onNotifications, unread, navigate, onSignOut }) {
  const [wsOpen, setWsOpen] = useStateShell(false);
  const [avOpen, setAvOpen] = useStateShell(false);
  const wsRef = useClickAway(wsOpen, () => setWsOpen(false));
  const avRef = useClickAway(avOpen, () => setAvOpen(false));
  return (
    <header className="ws-top">
      <button type="button" className="ws-top-burger" onClick={onHamburger}><Icon name="bars" /></button>
      <div className="ws-top-switchers">
        <div className="ws-dd" ref={wsRef}>
          <button type="button" className="ws-ws-trigger" onClick={() => setWsOpen(o => !o)}>
            <span className="ws-ws-badge">Y</span>
            <span className="ws-ws-name">YouComm Core</span>
            <Icon name="caret-down" className={'ws-dd-caret' + (wsOpen ? ' is-open' : '')} />
          </button>
          {wsOpen && (
            <div className="ws-dd-menu" style={{ minWidth: 240 }}>
              <div className="ws-dd-section">Workspaces</div>
              <div className="ws-dd-opt is-sel"><span><span className="ws-ws-badge sm">Y</span> YouComm Core</span><span className="ws-rolechip">Owner</span></div>
              <div className="ws-dd-opt"><span><span className="ws-ws-badge sm alt">L</span> LuckyStack OSS</span><span className="ws-rolechip">Member</span></div>
              <div className="ws-dd-divider" />
              <button type="button" className="ws-dd-opt as-btn" onClick={() => { setWsOpen(false); onCreateWorkspace?.(); }}><span><Icon name="plus" className="ws-dd-leadicon" /> Create workspace</span></button>
              <button type="button" className="ws-dd-opt as-btn" onClick={() => { setWsOpen(false); onManageMembers?.(); }}><span><Icon name="users" className="ws-dd-leadicon" /> Manage members</span></button>
            </div>
          )}
        </div>
        <span className="ws-top-sep">/</span>
        <Dropdown value="youcomm-app" items={[
          { id: 'youcomm-app', label: 'youcomm-app' },
          { id: 'youcomm-api', label: 'youcomm-api' },
        ]} />
      </div>

      <button type="button" className="ws-cmdk" onClick={onCmdK}><Icon name="magnifying-glass" /><span>Search</span><kbd>⌘K</kbd></button>

      <div className="ws-top-right">
        <div className="ws-presence" title="Sanne, Tom viewing">
          <AvatarStack users={presence} size={24} max={3} />
        </div>
        <button type="button" className="ws-iconbtn ws-bell" title="Notifications" onClick={onNotifications}>
          <Icon name="bell" />{unread > 0 && <span className="ws-bell-badge">{unread}</span>}
        </button>
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <div className="ws-dd" ref={avRef}>
          <button type="button" className="ws-top-avatar" onClick={() => setAvOpen(o => !o)}><Avatar user={me} size={30} /></button>
          {avOpen && (
            <div className="ws-dd-menu is-right" style={{ minWidth: 220 }}>
              <div className="ws-avmenu-head"><Avatar user={me} size={34} /><div><div className="ws-keyrow-name">{me.name}</div><div className="ws-keyrow-meta">mathijs@youcomm.nl</div></div></div>
              <div className="ws-dd-divider" />
              <button type="button" className="ws-dd-opt as-btn" onClick={() => { setAvOpen(false); navigate('settings'); }}><span><Icon name="user" className="ws-dd-leadicon" /> Account</span></button>
              <button type="button" className="ws-dd-opt as-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><span><Icon name={theme === 'dark' ? 'sun' : 'moon'} className="ws-dd-leadicon" /> Theme: {theme}</span></button>
              <button type="button" className="ws-dd-opt as-btn"><span><Icon name="language" className="ws-dd-leadicon" /> Language: English</span></button>
              <div className="ws-dd-divider" />
              <button type="button" className="ws-dd-opt as-btn is-danger" onClick={() => { setAvOpen(false); onSignOut?.(); }}><span><Icon name="right-from-bracket" className="ws-dd-leadicon" /> Sign out</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function TabBar({ tabs, view, navigate, onClose, onAI, aiCount, onCmdK, onNewTicket }) {
  return (
    <div className="ws-tabs">
      <div className="ws-tabs-list">
        {tabs.map(tab => (
          <div key={tab.id}
            className={'ws-tab' + (view === tab.id ? ' is-active' : '')}
            onClick={() => navigate(tab.id)}>
            {tab.id === 'board'
              ? <Icon name="table-columns" className="ws-tab-ic" />
              : <span className="ws-tab-dot" style={{ background: STATUS_META[tab.status]?.color ?? 'var(--muted)' }} />}
            <span className="ws-tab-label">{tab.label}</span>
            {tab.id !== 'board' && (
              <button type="button" className="ws-tab-x" onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}><Icon name="xmark" /></button>
            )}
          </div>
        ))}
        <PopMenu icon="plus" align="left" triggerClass="ws-tab-add" items={[
          { label: 'Open ticket…', icon: 'magnifying-glass', onClick: onCmdK },
          { label: 'New terminal…', icon: 'terminal', onClick: () => navigate('terminals') },
          { label: 'New ticket', icon: 'plus', onClick: onNewTicket },
        ]} />
      </div>
      <button type="button" className="ws-ai-toggle" onClick={onAI}>
        <Icon name="robot" /> <span>Workspace-AI</span>
        {aiCount > 0 && <span className="ws-ai-count">{aiCount}</span>}
      </button>
    </div>
  );
}

function AIPanel({ suggestions, onClose, onAccept, onDismiss, onOpenTicket }) {
  return (
    <aside className="ws-ai">
      <div className="ws-ai-head">
        <div className="ws-ai-headl"><span className="ws-ai-bot"><Icon name="robot" /></span><span>Workspace-AI</span></div>
        <button type="button" className="ws-iconbtn" onClick={onClose}><Icon name="xmark" /></button>
      </div>
      <div className="ws-ai-tabs">
        <span className="is-active">Suggestions</span><span>Notes</span><span>Config</span><span>Watch</span>
      </div>
      <div className="ws-ai-list">
        {suggestions.length === 0 && (
          <div className="ws-empty"><div className="ws-empty-t">All caught up ✨</div></div>
        )}
        {suggestions.map(s => (
          <div key={s.id} className="ws-ai-card">
            <div className="ws-ai-card-top"><span className="ws-ai-bot sm"><Icon name="robot" /></span><span className="ws-ai-card-title">{s.title}</span></div>
            <p className="ws-ai-card-body">{s.body}</p>
            <div className="ws-ai-card-tickets">{s.tickets.map(t => <button key={t} type="button" className="ws-ai-tk" onClick={() => onOpenTicket?.(t)}>{t}</button>)}</div>
            <div className="ws-ai-card-acts">
              <Button variant="primary" onClick={() => onAccept(s.id)}>Accept</Button>
              <Button variant="ghost" onClick={() => onDismiss(s.id)}>Dismiss</Button>
              <button type="button" className="ws-ai-snooze" title="Snooze"><Icon name="clock" /></button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MobileBottomBar({ active, setActive, onFab }) {
  const items = [
    { id: 'board', icon: 'table-columns', label: 'Board' },
    { id: 'terminals', icon: 'terminal', label: 'Terminals' },
    { id: 'activity', icon: 'wave-square', label: 'Activity' },
    { id: 'ai', icon: 'robot', label: 'AI' },
  ];
  return (
    <nav className="ws-bottom">
      {items.map((it, i) => (
        <React.Fragment key={it.id}>
          {i === 2 && <button type="button" className="ws-fab" onClick={onFab}><Icon name="plus" /></button>}
          <button type="button" className={'ws-bottom-item' + (active === it.id ? ' is-active' : '')} onClick={() => setActive(it.id)}>
            <Icon name={it.icon} /><span>{it.label}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

Object.assign(window, { NavRail, TopBar, TabBar, AIPanel, MobileBottomBar });
