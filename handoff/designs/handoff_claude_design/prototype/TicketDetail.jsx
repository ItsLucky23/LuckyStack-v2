/* Workspaces UI kit — ticket detail (tabbed). */
const { useState: useStateTicket } = React;

function DiffFile({ f }) {
  return (
    <div className="ws-file">
      <Icon name="file-code" className="ws-file-ic" />
      <span className="ws-file-path">{f.path}</span>
      {f.add != null && <span className="ws-file-stat"><span className="ws-add">+{f.add}</span> <span className="ws-del">−{f.del}</span></span>}
    </div>
  );
}

function TicketDetail({ id, ctx }) {
  const t = window.WS_TICKETS.find(x => x.id === id);
  const d = window.WS_TICKET_DETAIL[id] ?? { description: 'No description yet.', files: [], links: [], history: [] };
  const stage = window.WS_STAGES.find(s => s.id === t.stage);
  const [tab, setTab] = useStateTicket('overview');
  const members = ctx.members;
  const viewers = (t.viewers ?? []).map(v => members[v]).filter(Boolean);
  const term = window.WS_TERMINALS.find(x => x.id === id);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'files', label: 'Files & refs', count: d.files.length || null },
    { id: 'activity', label: 'Activity' },
    { id: 'links', label: 'Links', count: d.links.length || null },
    { id: 'history', label: 'Stage history' },
  ];

  return (
    <div className="ws-screen ws-tdetail">
      <div className="ws-td-head">
        <div className="ws-td-head-main">
          <div className="ws-td-id">{id} · <span className="ws-td-issue">{d.issue}</span></div>
          <h1 className="ws-td-title">{t.title}</h1>
          <div className="ws-td-meta">
            <span className="ws-badge-stage">{stage.name}</span>
            <span><Icon name="calendar-day" /> {window.WS_SPRINT}</span>
            <span><Icon name="code-branch" /> {d.branch}</span>
            <span><Icon name="code-pull-request" /> {d.mr}</span>
            {t.labels.map(l => <Label key={l} name={l} />)}
            {window.WS_TICKET_COST[id] && <span className="ws-cost-chip">{window.WS_TICKET_COST[id]}</span>}
            {id === 'DEV-1245' && <span className="ws-preview-chip"><Icon name="globe" /> preview · live</span>}
          </div>
        </div>
        <div className="ws-td-head-side">
          <Dropdown value={t.status} align="right" onChange={() => {}} items={[
            { id: 'busy', label: 'Busy' }, { id: 'needs-input', label: 'Needs input' }, { id: 'done', label: 'Done' },
          ]} />
          {viewers.length > 0 && <div className="ws-td-viewers"><AvatarStack users={viewers} size={24} /></div>}
        </div>
      </div>

      {t.status === 'needs-input' && d.needsInput && (
        <div className="ws-banner is-warn">
          <Icon name="circle-question" />
          <div><strong>The AI is waiting for your input</strong><p>{d.needsInput}</p></div>
          <div className="ws-banner-reply"><input className="ws-input2" placeholder="Type a reply…" /><Button>Send</Button></div>
        </div>
      )}
      {t.status === 'done' && (
        <div className="ws-banner is-ok">
          <Icon name="circle-check" />
          <div><strong>Stage complete</strong><p>Ready to move forward.</p></div>
          <Button onClick={() => ctx.openModal('promote', { ticket: id })}>Promote to next stage</Button>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="ws-td-body">
        {tab === 'overview' && (
          <div className="ws-td-cols">
            <div className="ws-td-main">
              <SectionCard title="Description"><p className="ws-prose">{d.description}</p></SectionCard>
              <SectionCard title="Carry-over from previous stage">
                <p className="ws-prose ws-carry">{d.carryOver ?? 'Nothing carried over yet.'}</p>
              </SectionCard>
            </div>
            <div className="ws-td-aside">
              <SectionCard title="Stage config">
                <div className="ws-kv"><span>AI</span><StatusPill status={stage.ai ? 'busy' : 'idle'} dot={false} /></div>
                <div className="ws-kv"><span>Sources</span><span className="ws-kv-v">summary, db-schema</span></div>
                <div className="ws-kv"><span>Skills</span><span className="ws-kv-v">RAG, graphify, test</span></div>
                <div className="ws-kv"><span>Mongo</span><span className="ws-kv-v">read-write</span></div>
              </SectionCard>
              <div className="ws-td-actions">
                <Button variant="secondary" icon="up-right-from-square">Open in GitLab</Button>
                <Button variant="secondary" icon="terminal" onClick={() => setTab('terminal')}>Open terminal</Button>
                <Button variant="danger" icon="trash-can" onClick={() => ctx.openModal('confirm', { title: `Teardown ${id} container?`, body: 'The running container and its terminals will be destroyed.', confirmLabel: 'Teardown', danger: true, input: id })}>Teardown container</Button>
              </div>
            </div>
          </div>
        )}
        {tab === 'terminal' && (
          term ? <div className="ws-td-term"><TerminalView term={term} /></div>
               : <EmptyState icon="terminal" title="No terminal running" sub="Start one to drive this ticket's container." action={<Button icon="play">Start a terminal</Button>} />
        )}
        {tab === 'files' && (
          <SectionCard title="Linked files & references" right={<Button variant="secondary" icon="plus" onClick={() => ctx.openModal('reference')}>Add reference</Button>}>
            {d.files.length ? d.files.map(f => <DiffFile key={f.path} f={f} />) : <EmptyState icon="file-code" title="No files referenced" sub="Reference files from the worktree to pin them." />}
          </SectionCard>
        )}
        {tab === 'activity' && (
          <SectionCard title="Activity">
            {window.WS_EVENTS.filter(e => e.ticket === id).map((e, i) => <EventRow key={i} e={e} members={members} hideTicket />)}
          </SectionCard>
        )}
        {tab === 'links' && (
          <SectionCard title="Linked tickets" right={<Button variant="secondary" icon="link" onClick={() => ctx.openModal('reference')}>Link ticket</Button>}>
            {d.links.length ? d.links.map(l => (
              <button key={l.id} type="button" className="ws-linkrow" onClick={() => ctx.openTicket(l.id)}>
                <span className="ws-linkrow-rel">{l.rel}</span>
                <span className="ws-linkrow-id">{l.id}</span>
                <span className="ws-linkrow-t">{window.WS_TICKETS.find(x => x.id === l.id)?.title}</span>
                {l.ai && <span className="ws-ai-suggest"><Icon name="robot" /> suggested</span>}
              </button>
            )) : <EmptyState icon="link" title="No links yet" />}
          </SectionCard>
        )}
        {tab === 'history' && (
          <SectionCard title="Stage history">
            <div className="ws-timeline">
              {d.history.map((h, i) => (
                <div key={i} className="ws-tl-item">
                  <span className={'ws-tl-dot ' + (h.done ? 'is-done' : 'is-now')} />
                  <div><div className="ws-tl-stage">{h.stage}{!h.done && <span className="ws-tl-now"> · current</span>}</div><div className="ws-tl-sum">{h.summary}</div></div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { TicketDetail });
