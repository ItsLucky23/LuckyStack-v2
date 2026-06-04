/* Workspaces UI kit — backlog (Wave 4: bulk-select + sort). */
const { useState: useStateBl } = React;

function BacklogScreen({ ctx }) {
  const [filter, setFilter] = useStateBl('all');
  const [selMode, setSelMode] = useStateBl(false);
  const [sel, setSel] = useStateBl({});
  const [sort, setSort] = useStateBl({ key: 'last', dir: 'desc' });
  const [query, setQuery] = useStateBl('');
  const stages = Object.fromEntries(window.WS_STAGES.map(s => [s.id, s.name]));
  const stageOrder = Object.fromEntries(window.WS_STAGES.map((s, i) => [s.id, i]));

  let rows = window.WS_TICKETS.slice();
  if (filter === 'needs') rows = rows.filter(t => t.status === 'needs-input');
  else if (filter === 'unrefined') rows = rows.filter(t => t.stage === 'unrefined');
  else if (filter === 'done') rows = rows.filter(t => t.status === 'done');
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter(t => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || t.labels.some(l => l.includes(q)));
  rows.sort((a, b) => {
    let av, bv;
    if (sort.key === 'stage') { av = stageOrder[a.stage]; bv = stageOrder[b.stage]; }
    else if (sort.key === 'status') { av = a.status; bv = b.status; }
    else { av = a.terminal ? 1 : 0; bv = b.terminal ? 1 : 0; }
    const c = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'asc' ? c : -c;
  });
  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const selCount = Object.values(sel).filter(Boolean).length;
  const SortTh = ({ k, children }) => (
    <th className="ws-th-sort" onClick={() => toggleSort(k)}>{children} {sort.key === k && <Icon name={sort.dir === 'asc' ? 'caret-up' : 'caret-down'} />}</th>
  );

  return (
    <div className="ws-screen">
      <ScreenHead title="Backlog" sub={`${rows.length} tickets`}>
        <div className="ws-search-box"><Icon name="magnifying-glass" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tickets…" />{query && <button type="button" className="ws-search-clear" onClick={() => setQuery('')}><Icon name="xmark" /></button>}</div>
        <button type="button" className={'ws-btn ws-btn-secondary' + (selMode ? ' is-active' : '')} onClick={() => { setSelMode(m => !m); setSel({}); }}><Icon name="square-check" /> {selMode ? 'Done' : 'Select'}</button>
        <Button icon="plus" onClick={() => ctx.openModal('createTicket')}>{ctx.isMobile ? '' : 'Ticket'}</Button>
      </ScreenHead>
      <div className="ws-bl-tabs">
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'unrefined', label: 'Unrefined' }, { id: 'needs', label: 'Needs input' }, { id: 'done', label: 'Done' }]} />
        <button type="button" className="ws-btn ws-btn-secondary ws-bl-filter" onClick={() => ctx.openModal('boardFilter')}><Icon name="filter" /> Filter</button>
      </div>

      {ctx.isMobile ? (
        <div className="ws-bl-cards">
          {rows.map(t => (
            <button key={t.id} type="button" className="ws-bl-card" onClick={() => selMode ? setSel(s => ({ ...s, [t.id]: !s[t.id] })) : ctx.openTicket(t.id)}>
              <div className="ws-bl-card-top"><span className="ws-card-id">{selMode && <span className={'ws-cb ' + (sel[t.id] ? 'on' : 'off')}>{sel[t.id] && <Icon name="check" />}</span>} {t.id}</span><StatusPill status={t.status} /></div>
              <div className="ws-bl-card-title">{t.title}</div>
              <div className="ws-bl-card-foot"><span className="ws-badge-stage">{stages[t.stage]}</span>{t.labels.slice(0, 2).map(l => <Label key={l} name={l} />)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="ws-table-wrap">
          <div className="ws-table-card">
            <table className="ws-table">
              <thead><tr>
                {selMode && <th className="ws-th-check"><span className="ws-cb off" /></th>}
                <th>Ticket</th><th className="ws-th-title">Title</th><SortTh k="stage">Stage</SortTh><SortTh k="status">Status</SortTh><th>AI / who</th><th>Labels</th><th>Sprint</th><SortTh k="last">Last</SortTh>
              </tr></thead>
              <tbody>
                {rows.map(t => {
                  const viewers = (t.viewers ?? []).map(v => ctx.members[v]).filter(Boolean);
                  return (
                    <tr key={t.id} onClick={() => selMode ? setSel(s => ({ ...s, [t.id]: !s[t.id] })) : ctx.openTicket(t.id)}>
                      {selMode && <td className="ws-th-check"><span className={'ws-cb ' + (sel[t.id] ? 'on' : 'off')}>{sel[t.id] && <Icon name="check" />}</span></td>}
                      <td className="ws-td-mono">{t.id}</td>
                      <td className="ws-td-titlecell">{t.title}</td>
                      <td><span className="ws-badge-stage">{stages[t.stage]}</span></td>
                      <td><StatusPill status={t.status} /></td>
                      <td>{viewers.length ? <AvatarStack users={viewers} size={20} /> : <span className="ws-dash">—</span>}</td>
                      <td><div className="ws-td-labels">{t.labels.map(l => <Label key={l} name={l} />)}</div></td>
                      <td className="ws-td-dim">S24</td>
                      <td className="ws-td-dim">{t.terminal ? '2m' : '1h'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <EmptyState icon="magnifying-glass" title="No tickets match" sub="Try a different search or filter." />}
          </div>
        </div>
      )}

      {selMode && selCount > 0 && (
        <div className="ws-bulkbar">
          <span className="ws-bulk-count">{selCount} selected</span>
          <div className="ws-bulk-acts">
            <Button variant="secondary" icon="diagram-project">Move ▸</Button>
            <Button variant="secondary" icon="circle-half-stroke">Set status ▸</Button>
            <Button variant="secondary" icon="user">Assign ▸</Button>
            <Button variant="secondary" icon="calendar-day">Add to sprint</Button>
            <Button variant="danger" icon="box-archive" onClick={() => ctx.openModal('confirm', { title: `Archive ${selCount} tickets?`, confirmLabel: 'Archive', danger: true })}>Archive</Button>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BacklogScreen });
