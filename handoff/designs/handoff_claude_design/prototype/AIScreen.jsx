/* Workspaces UI kit — full Workspace-AI screen. */
const { useState: useStateAI } = React;

function AIScreen({ ctx }) {
  const [tab, setTab] = useStateAI('suggestions');
  const [items, setItems] = useStateAI(ctx.suggestions);
  const remove = (id) => { setItems(s => s.filter(x => x.id !== id)); ctx.onDismiss?.(id); };

  return (
    <div className="ws-screen">
      <ScreenHead title="Workspace-AI" sub="suggestions & oversight" />
      <Tabs tabs={[
        { id: 'suggestions', label: 'Suggestions', count: items.length || null },
        { id: 'notes', label: 'Notes' },
        { id: 'config', label: 'Config review', count: 1 },
        { id: 'watch', label: 'Watch', count: 1 },
      ]} active={tab} onChange={setTab} />

      <div className="ws-ai-screenbody">
        {tab === 'suggestions' && (items.length ? items.map(s => (
          <div key={s.id} className="ws-ai-card is-screen">
            <div className="ws-ai-card-top"><span className="ws-ai-bot sm"><Icon name="robot" /></span><span className="ws-ai-card-title">{s.title}</span></div>
            <p className="ws-ai-card-body">{s.body}</p>
            <div className="ws-ai-card-tickets">{s.tickets.map(t => (
              <button key={t} type="button" className="ws-ai-tk" onClick={() => ctx.openTicket(t)}>{t}</button>
            ))}</div>
            <div className="ws-ai-card-acts">
              <Button variant="secondary" onClick={() => ctx.openModal('suggestion', { suggestion: s })}>Details</Button>
              <Button onClick={() => remove(s.id)}>Accept</Button>
              <Button variant="ghost" onClick={() => remove(s.id)}>Dismiss</Button>
              <button type="button" className="ws-ai-snooze" title="Snooze"><Icon name="clock" /></button>
            </div>
          </div>
        )) : <EmptyState title="All caught up ✨" sub="No open suggestions right now." />)}

        {tab === 'notes' && (
          <div className="ws-ai-card is-screen"><div className="ws-ai-card-top"><span className="ws-ai-bot sm"><Icon name="robot" /></span><span className="ws-ai-card-title">Observation</span></div>
          <p className="ws-ai-card-body">The board has 3 tickets in Plan touching auth/secrets — consider a freeze on that area until DEV-1241 lands.</p></div>
        )}

        {tab === 'config' && (
          <div className="ws-ai-card is-screen is-warn">
            <div className="ws-ai-card-top"><span className="ws-ai-bot sm"><Icon name="triangle-exclamation" /></span><span className="ws-ai-card-title">Stages may be swapped</span></div>
            <p className="ws-ai-card-body">“Refined” loads the full RAG index while “Plan” only loads the project summary — that's usually the other way around.</p>
            <div className="ws-ai-card-acts"><Button variant="secondary" icon="diagram-project" onClick={() => ctx.navigate('pipeline')}>Go to pipeline</Button></div>
          </div>
        )}

        {tab === 'watch' && (
          <div className="ws-ai-card is-screen">
            <div className="ws-ai-card-top"><span className="ws-ai-bot sm"><Icon name="eye" /></span><span className="ws-ai-card-title">Source out of date</span></div>
            <p className="ws-ai-card-body">RAG is 3 commits behind <span className="ws-code-inline">main</span> since DEV-1246 merged. Reindex to keep stage context fresh.</p>
            <div className="ws-ai-card-acts"><Button variant="secondary" icon="arrows-rotate" onClick={() => ctx.navigate('sources')}>Reindex sources</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { AIScreen });
