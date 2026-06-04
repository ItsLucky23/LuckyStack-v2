/* Workspaces UI kit — terminal view + terminals workspace (Wave 3). */
const { useState: useStateTerm } = React;

const TERM_COLORS = { g: 'var(--term-green)', b: 'var(--term-blue)', m: 'var(--term-muted)', r: 'var(--term-red)', t: 'var(--term-text)', c: 'var(--term-amber)' };

function TermLines({ lines }) {
  return (
    <div className="ws-term-body">
      {lines.map((ln, i) => (
        <div key={i} className="ws-term-line" style={{ color: TERM_COLORS[ln.t] }}>
          {ln.s && <span style={{ color: TERM_COLORS[ln.t], fontWeight: 600 }}>{ln.s}</span>}
          <span>{ln.x}</span>
          {ln.cursor && <span className="ws-term-cursor" />}
          {ln.wait && <span className="ws-term-wait">waiting for you</span>}
        </div>
      ))}
    </div>
  );
}

function TerminalView({ term, onOpenTicket, ctx, mobile }) {
  const [tab, setTab] = useStateTerm(term.activeTab);
  const waiting = term.lines.some(l => l.wait);
  const menu = [
    { label: 'Restart', icon: 'rotate-right', onClick: () => {} },
    { label: 'Pop out to tab', icon: 'up-right-from-square', onClick: () => onOpenTicket?.(term.id) },
    { label: 'Split', icon: 'table-columns', onClick: () => {} },
    { label: 'Rename', icon: 'pen', onClick: () => {} },
    { label: 'Copy buffer', icon: 'copy', onClick: () => {} },
    { label: 'Clear', icon: 'eraser', onClick: () => {} },
    { divider: true },
    { label: 'Kill', icon: 'xmark', danger: true, onClick: () => ctx?.openModal('confirm', { title: `Kill ${term.id} terminal?`, body: 'The process stops and the buffer is lost.', confirmLabel: 'Kill', danger: true }) },
  ];
  return (
    <div className="ws-term">
      <div className="ws-term-bar">
        <div className="ws-term-bar-l">
          <button type="button" className="ws-term-tid" onClick={() => onOpenTicket?.(term.id)}>{term.id}</button>
          <span className="ws-term-stage">{term.stage} · {term.proc}</span>
        </div>
        <div className="ws-term-bar-r">
          <span className={'ws-term-status ' + (waiting ? 'is-wait' : 'is-busy')}><span className="ws-term-dot" />{waiting ? 'needs input' : 'busy'}</span>
          <PopMenu items={menu} triggerClass="ws-term-x" />
        </div>
      </div>
      {term.tabs && (
        <div className="ws-term-tabs">
          {term.tabs.map(t => <button key={t} type="button" className={'ws-term-tab' + (t === tab ? ' is-active' : '')} onClick={() => setTab(t)}>{t}</button>)}
        </div>
      )}
      <TermLines lines={term.lines} />
      {waiting && (
        <div className="ws-term-reply"><input className="ws-term-input" placeholder="Reply to the AI…" /><button type="button" className="ws-term-send"><Icon name="paper-plane" /></button></div>
      )}
      {mobile && (
        <div className="ws-term-keys">{['Tab','Ctrl','Esc','↑','↓'].map(k => <button key={k} type="button" className="ws-term-key">{k}</button>)}<button type="button" className="ws-term-key is-kbd"><Icon name="keyboard" /></button></div>
      )}
      <div className="ws-term-foot"><span>cwd: {term.cwd}</span><span>exit: {term.exit}</span><span className="ws-term-grip"><Icon name="grip-lines" /></span></div>
    </div>
  );
}

function TerminalsScreen({ ctx }) {
  const [layout, setLayout] = useStateTerm('grid');
  const [unlocked, setUnlocked] = useStateTerm(false);
  const [unlocking, setUnlocking] = useStateTerm(false);
  const terms = window.WS_TERMINALS;
  return (
    <div className="ws-screen">
      <ScreenHead title="Terminals" sub={`${terms.length} active`}>
        <Segmented size="sm" value={layout} onChange={setLayout} options={[{ id: 'grid', label: 'Grid' }, { id: 'tabs', label: 'Tabs' }, { id: 'split', label: 'Split' }]} />
        <Button icon="plus">{ctx.isMobile ? '' : 'Open terminal'}</Button>
      </ScreenHead>
      <div className="ws-term-stagewrap">
        <div className={'ws-term-grid' + (ctx.isMobile ? ' is-mobile' : '') + (layout === 'tabs' ? ' is-tabs' : '')}>
          {terms.map(t => <TerminalView key={t.id} term={t} onOpenTicket={ctx.openTicket} ctx={ctx} mobile={ctx.isMobile} />)}
        </div>
        {!unlocked && (
          <div className="ws-ssh-overlay">
            <div className="ws-ssh-card">
              <span className="ws-ssh-ic"><Icon name="lock" /></span>
              <div className="ws-ssh-title">Unlock terminals with your SSH key</div>
              <div className="ws-ssh-sub">Your key signs a one-time challenge for this session.</div>
              <Button icon={unlocking ? 'spinner' : 'key'} onClick={() => { setUnlocking(true); setTimeout(() => setUnlocked(true), 1100); }}>
                {unlocking ? 'Unlocking…' : 'Unlock'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { TerminalView, TerminalsScreen, TermLines });
