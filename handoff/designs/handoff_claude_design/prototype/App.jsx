/* Workspaces UI kit — app composition + router + kit chrome. */
const { useState: useStateApp, useEffect: useEffectApp, useMemo } = React;

function groupByStage(tickets) {
  const by = {};
  tickets.forEach(t => { (by[t.stage] ??= []).push(t); });
  return by;
}
const isTicketView = (v) => /^DEV-/.test(v);

function renderAuth(s) {
  if (s === 'login') return <LoginScreen />;
  if (s === 'ssh') return <SshLinkScreen />;
  if (s === 'invite') return <AcceptInviteScreen />;
  return <OnboardingScreen />;
}

/* Render the active screen — shared between desktop and phone. */
function Screen({ view, ctx }) {
  if (isTicketView(view)) return <TicketDetail id={view} ctx={ctx} />;
  switch (view) {
    case 'backlog':   return <BacklogScreen ctx={ctx} />;
    case 'terminals': return <TerminalsScreen ctx={ctx} />;
    case 'activity':  return <ActivityScreen ctx={ctx} />;
    case 'sources':   return <SourcesScreen ctx={ctx} />;
    case 'pipeline':  return <PipelineScreen ctx={ctx} />;
    case 'ai':        return <AIScreen ctx={ctx} />;
    case 'usage':     return <UsageScreen ctx={ctx} />;
    case 'settings':  return <SettingsScreen ctx={ctx} initialScope="account" />;
    case 'workspace': return <SettingsScreen ctx={ctx} initialScope="workspace" initialTab="members" />;
    case 'board':
    default:
      return (
        <div className="ws-screen">
          <BoardHeader ctx={ctx} isMobile={ctx.isMobile} />
          {ctx.isMobile
            ? <BoardMobile stages={ctx.stages} ticketsByStage={ctx.ticketsByStage} members={ctx.members} ctx={ctx} />
            : <BoardDesktop stages={ctx.stages} ticketsByStage={ctx.ticketsByStage} members={ctx.members} ctx={ctx} />}
        </div>
      );
  }
}

function DesktopApp({ ctx, expanded, setExpanded, aiOpen, setAiOpen, tabs, closeTab, onCmdK }) {
  const { view, navigate, suggestions } = ctx;
  const presence = [ctx.members.sanne, ctx.members.tom, ctx.members.mathijs];
  const showAi = aiOpen && (view === 'board' || isTicketView(view));
  return (
    <div className="ws-app">
      <NavRail expanded={expanded} setExpanded={setExpanded} active={view} onNavigate={navigate} me={ctx.me} aiCount={suggestions.length} />
      <div className="ws-main">
        <TopBar me={ctx.me} presence={presence} theme={ctx.theme} setTheme={ctx.setTheme} onHamburger={() => setExpanded(true)} onCmdK={onCmdK}
          onCreateWorkspace={() => ctx.openModal('createWorkspace')} onManageMembers={() => navigate('workspace')}
          onNotifications={() => ctx.openModal('notifications')} unread={ctx.unread} navigate={navigate} onSignOut={ctx.onSignOut} />
        <TabBar tabs={tabs} view={view} navigate={navigate} onClose={closeTab} onAI={() => setAiOpen(o => !o)} aiCount={suggestions.length} onCmdK={onCmdK} onNewTicket={() => ctx.openModal('createTicket')} />
        <div className="ws-stage">
          <div className="ws-content"><Screen view={view} ctx={ctx} /></div>
          {showAi && <AIPanel suggestions={suggestions} onClose={() => setAiOpen(false)} onAccept={ctx.onDismiss} onDismiss={ctx.onDismiss} onOpenTicket={ctx.openTicket} navigate={navigate} />}
        </div>
      </div>
    </div>
  );
}

function PhoneApp({ ctx, onVoice }) {
  const { view, navigate } = ctx;
  const [drawer, setDrawer] = useStateApp(false);
  const bottomActive = ['board', 'terminals', 'activity', 'ai'].includes(view) ? view : (isTicketView(view) ? 'board' : view);
  return (
    <div className="ws-phoneapp">
      <header className="ws-mtop">
        {isTicketView(view)
          ? <button type="button" className="ws-mback" onClick={() => navigate('board')}><Icon name="angle-left" /> Board</button>
          : <button type="button" className="ws-iconbtn ws-iconbtn-plain" onClick={() => setDrawer(true)}><Icon name="bars" /></button>}
        <button type="button" className="ws-mtop-ws"><span className="ws-ws-badge sm">Y</span> YouComm Core <Icon name="caret-down" /></button>
        <div className="ws-mtop-r">
          <IconButton icon="magnifying-glass" onClick={ctx.onCmdK} />
          <div className="ws-top-avatar"><Avatar user={ctx.me} size={28} /></div>
        </div>
      </header>

      {(view === 'board' || isTicketView(view)) && !isTicketView(view) && (
        <div className="ws-mstrip">
          <span className="is-active"><Icon name="table-columns" /> Board</span>
          {ctx.openTabs.map(id => (
            <span key={id} onClick={() => navigate(id)}><span className="ws-tab-dot" style={{ background: STATUS_META[window.WS_TICKETS.find(t=>t.id===id)?.status]?.color }} /> {id}</span>
          ))}
          <button type="button" className="ws-mstrip-tabs"><Icon name="table-cells-large" /></button>
        </div>
      )}

      <div className="ws-mcontent"><Screen view={view} ctx={{ ...ctx, isMobile: true }} /></div>

      <MobileBottomBar active={bottomActive} setActive={navigate} onFab={onVoice} />

      {drawer && (<>
        <div className="ws-drawer-scrim" onClick={() => setDrawer(false)} />
        <div className="ws-drawer">
          <div className="ws-rail-brand" style={{ padding: '4px 6px 14px' }}><img src="assets/logo-mark.svg" className="ws-rail-logo" alt="" /><span className="ws-rail-name">Workspaces</span></div>
          {[...NAV_ITEMS, ...NAV_BOTTOM].map(it => (
            <button key={it.id} type="button" className={'ws-nav-item is-drawer' + (view === it.id ? ' is-active' : '')} onClick={() => { navigate(it.id); setDrawer(false); }}>
              <span className="ws-nav-ic"><Icon name={it.icon} /></span><span className="ws-nav-lab">{it.label}</span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  );
}

function App() {
  const [theme, setTheme] = useStateApp(() => localStorage.getItem('ws-theme') || 'light');
  const [device, setDevice] = useStateApp(() => localStorage.getItem('ws-device') || 'desktop');
  const [suggestions, setSuggestions] = useStateApp(window.WS_AI_SUGGESTIONS);
  const [view, setView] = useStateApp('board');
  const [openTabs, setOpenTabs] = useStateApp(['DEV-1240', 'DEV-1245', 'DEV-1242']);
  const [expanded, setExpanded] = useStateApp(false);
  const [aiOpen, setAiOpen] = useStateApp(true);
  const [modal, setModal] = useStateApp(null); // { kind, ...props }
  const openModal = (kind, props = {}) => setModal({ kind, ...props });
  const closeModal = () => setModal(null);
  const [screenSet, setScreenSet] = useStateApp('app'); // app | login | ssh | invite | onboarding

  useEffectApp(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ws-theme', theme);
  }, [theme]);
  useEffectApp(() => { localStorage.setItem('ws-device', device); }, [device]);
  // FontAwesome SVG-JS can miss React-mounted <i> nodes (menus, modals, sub-tabs).
  // A light periodic re-scan converts any stragglers; already-converted <svg> are skipped.
  useEffectApp(() => {
    const scan = () => { try { window.FontAwesome && window.FontAwesome.dom.i2svg(); } catch (e) {} };
    scan();
    const id = setInterval(scan, 200);
    return () => clearInterval(id);
  }, []);
  useEffectApp(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal({ kind: 'cmd' }); }
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigate = (v) => { setView(v); setModal(null); };
  const openTicket = (id) => { setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id]); setView(id); setModal(null); };
  const closeTab = (id) => { setOpenTabs(prev => prev.filter(t => t !== id)); setView(v => (v === id ? 'board' : v)); };
  const onDismiss = (id) => setSuggestions(s => s.filter(x => x.id !== id));

  const ctx = {
    view, navigate, openTicket, openTabs,
    me: window.WS_MEMBERS.mathijs, members: window.WS_MEMBERS,
    stages: window.WS_STAGES, ticketsByStage: useMemo(() => groupByStage(window.WS_TICKETS), []),
    theme, setTheme, suggestions, onDismiss, isMobile: device === 'phone',
    onCmdK: () => setModal({ kind: 'cmd' }), openModal, closeModal,
    unread: window.WS_NOTIFICATIONS.filter(n => !n.read).length,
    onSignOut: () => setScreenSet('login'),
  };
  const tabs = [{ id: 'board', label: 'Board' }, ...openTabs.map(id => ({ id, label: id, status: window.WS_TICKETS.find(t => t.id === id)?.status }))];

  return (
    <div className="ws-root">
      <div className="ws-kitbar">
        <div className="ws-kitbar-l"><img src="assets/logo-mark.svg" className="ws-kitbar-logo" alt="" /><span>Workspaces UI kit</span><span className="ws-kitbar-sub">Full app</span></div>
        <div className="ws-kitbar-r">
          <select className="ws-kitsel" value={screenSet} onChange={e => setScreenSet(e.target.value)}>
            <option value="app">App</option>
            <option value="login">Login</option>
            <option value="ssh">SSH setup</option>
            <option value="invite">Accept invite</option>
            <option value="onboarding">Onboarding</option>
          </select>
          <div className="ws-seg">
            <button type="button" className={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')}><Icon name="display" /> Desktop</button>
            <button type="button" className={device === 'phone' ? 'is-on' : ''} onClick={() => setDevice('phone')}><Icon name="mobile-screen" /> Phone</button>
          </div>
          <div className="ws-seg">
            <button type="button" className={theme === 'light' ? 'is-on' : ''} onClick={() => setTheme('light')}><Icon name="sun" /> Light</button>
            <button type="button" className={theme === 'dark' ? 'is-on' : ''} onClick={() => setTheme('dark')}><Icon name="moon" /> Dark</button>
          </div>
        </div>
      </div>
      <div className={'ws-viewport ws-viewport-' + device}>
        {screenSet !== 'app'
          ? (device === 'phone'
              ? <div className="ws-phoneframe"><div className="ws-phonescreen">{renderAuth(screenSet)}</div></div>
              : renderAuth(screenSet))
          : (device === 'desktop'
              ? <DesktopApp ctx={ctx} expanded={expanded} setExpanded={setExpanded} aiOpen={aiOpen} setAiOpen={setAiOpen} tabs={tabs} closeTab={closeTab} onCmdK={() => openModal('cmd')} />
              : <div className="ws-phoneframe"><div className="ws-phonescreen"><PhoneApp ctx={ctx} onVoice={() => openModal('voice')} /></div></div>)}
      </div>
      {modal?.kind === 'cmd' && <CommandPalette ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'voice' && <VoiceSheet ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'createWorkspace' && <CreateWorkspaceModal onClose={closeModal} />}
      {modal?.kind === 'createTicket' && <CreateTicketModal onClose={closeModal} />}
      {modal?.kind === 'invite' && <InviteModal onClose={closeModal} />}
      {modal?.kind === 'notifications' && <NotificationCenter ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'sprint' && <SprintModal onClose={closeModal} />}
      {modal?.kind === 'sprints' && <SprintsManager ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'budget' && <BudgetCapModal ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'reference' && <ReferencePicker ctx={ctx} onClose={closeModal} />}
      {modal?.kind === 'promote' && <PromotePreview ctx={ctx} onClose={closeModal} ticket={modal.ticket} />}
      {modal?.kind === 'quickview' && <TicketQuickview ctx={ctx} onClose={closeModal} id={modal.id} />}
      {modal?.kind === 'boardFilter' && <BoardFilter onClose={closeModal} />}
      {modal?.kind === 'suggestion' && <SuggestionDetail ctx={ctx} onClose={closeModal} suggestion={modal.suggestion} />}
      {modal?.kind === 'skill' && <SkillDetail onClose={closeModal} skill={modal.skill} />}
      {modal?.kind === 'sourcePreview' && <SourcePreview onClose={closeModal} doc={modal.doc} />}
      {modal?.kind === 'upload' && <UploadSpec onClose={closeModal} />}
      {modal?.kind === 'addKey' && <AddSshKey onClose={closeModal} />}
      {modal?.kind === 'confirm' && <ConfirmDialog {...modal} onClose={closeModal} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
