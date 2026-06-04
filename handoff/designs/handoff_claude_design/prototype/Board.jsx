/* Workspaces UI kit — the scrum board (Wave 3: menus, cost chips, drag affordances). */
const { useState: useStateBoard } = React;

function cardMenuItems(ctx, t) {
  return [
    { label: 'Quick view', icon: 'eye', onClick: () => ctx.openModal('quickview', { id: t.id }) },
    { label: 'Open ticket', icon: 'up-right-from-square', onClick: () => ctx.openTicket(t.id) },
    { label: 'Open terminal', icon: 'terminal', onClick: () => ctx.navigate('terminals') },
    { label: 'Add reference…', icon: 'link', onClick: () => ctx.openModal('reference') },
    { divider: true },
    { label: t.paused ? 'Resume agent' : 'Pause agent', icon: t.paused ? 'play' : 'pause', onClick: () => {} },
    { label: 'Copy DEV-ID', icon: 'copy', onClick: () => {} },
    { divider: true },
    { label: 'Archive', icon: 'box-archive', danger: true, onClick: () => ctx.openModal('confirm', { title: `Archive ${t.id}?`, body: 'It will move out of the active board.', confirmLabel: 'Archive', danger: true }) },
  ];
}

function KanbanCard({ ticket, members, ctx }) {
  const viewers = (ticket.viewers ?? []).map(id => members[id]).filter(Boolean);
  const cost = window.WS_TICKET_COST[ticket.id];
  const stuck = ticket.id === 'DEV-1242';
  return (
    <div className="ws-card" role="button" tabIndex={0} onClick={() => ctx.openTicket(ticket.id)}>
      <span className="ws-card-grip"><Icon name="grip-vertical" /></span>
      <div className="ws-card-top">
        <span className="ws-card-id">{ticket.id}</span>
        <div className="ws-card-topr" onClick={e => e.stopPropagation()}>
          {ticket.status !== 'idle'
            ? <StatusPill status={ticket.status} />
            : <span className="ws-card-noai"><Icon name="moon" /> no AI</span>}
          <PopMenu items={cardMenuItems(ctx, ticket)} triggerClass="ws-card-menu" />
        </div>
      </div>
      <div className="ws-card-title">{ticket.title}</div>
      {ticket.labels?.length > 0 && (
        <div className="ws-card-labels">{ticket.labels.map(l => <Label key={l} name={l} />)}</div>
      )}
      <div className="ws-card-foot">
        {viewers.length > 0 ? <AvatarStack users={viewers} size={20} /> : <span className="ws-card-unassigned">Unassigned</span>}
        <div className="ws-card-footr">
          {cost && <span className="ws-cost-chip">{cost}</span>}
          {ticket.terminal && <span className="ws-card-live"><span className="ws-card-live-dot ws-pulse" /> terminal</span>}
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({ stage, tickets, members, ctx }) {
  const wipOver = stage.id === 'plan' && tickets.length > 2;
  return (
    <div className={'ws-col' + (stage.ai ? '' : ' ws-col-noai')}>
      <div className={'ws-col-head' + (wipOver ? ' is-wip' : '')}>
        <div className="ws-col-headl">
          <span className="ws-col-name">{stage.name}</span>
          <span className="ws-col-count">{tickets.length}</span>
          {wipOver && <span className="ws-wip-flag" title="Over WIP limit"><Icon name="triangle-exclamation" /></span>}
          {stage.ai && <Icon name="robot" className="ws-col-ai" title="AI-enabled stage" />}
        </div>
        <button type="button" className="ws-col-add" onClick={() => ctx.openModal('createTicket')} title="New ticket"><Icon name="plus" /></button>
      </div>
      <div className="ws-col-list">
        {tickets.map(t => <KanbanCard key={t.id} ticket={t} members={members} ctx={ctx} />)}
        {tickets.length === 0 && <div className="ws-col-empty">No tickets</div>}
        <button type="button" className="ws-col-addcard" onClick={() => ctx.openModal('createTicket')}>
          <Icon name="plus" /> Add ticket
        </button>
      </div>
    </div>
  );
}

function BoardHeader({ ctx, isMobile }) {
  const sprintItems = window.WS_SPRINTS.map(s => ({ id: s.id, label: s.start ? `${s.name} · ${s.daysLeft ? s.daysLeft + 'd left' : s.start + '–' + s.end}` : s.name }));
  return (
    <div className="ws-board-head">
      <div className="ws-board-title">
        <span className="ws-board-h1">Board</span>
        {!isMobile && <span className="ws-board-sub">youcomm-app</span>}
      </div>
      <div className="ws-board-tools">
        <Dropdown icon="calendar-day" value="s24" items={[...sprintItems, { id: 'manage', label: '⚙ Manage sprints…' }]} onSelect={(it) => { if (it.id === 'manage') ctx.openModal('sprints'); }} />
        {!isMobile && <button type="button" className="ws-iconbtn" title="Pause all agents" onClick={() => ctx.openModal('confirm', { title: 'Pause all agents?', body: 'Every running agent in this workspace will pause. You can resume any time.', confirmLabel: 'Pause all' })}><Icon name="pause" /></button>}
        <button type="button" className="ws-btn ws-btn-secondary" onClick={() => ctx.openModal('boardFilter')}><Icon name="filter" /> {isMobile ? '' : 'Filter'}</button>
        <Button icon="plus" onClick={() => ctx.openModal('createTicket')}>{isMobile ? '' : 'Ticket'}</Button>
      </div>
    </div>
  );
}

function BoardDesktop({ stages, ticketsByStage, members, ctx }) {
  return (
    <div className="ws-board-scroll">
      <div className="ws-board-cols">
        {stages.map(s => <KanbanColumn key={s.id} stage={s} tickets={ticketsByStage[s.id] ?? []} members={members} ctx={ctx} />)}
      </div>
    </div>
  );
}

function BoardMobile({ stages, ticketsByStage, members, ctx }) {
  const [active, setActive] = useStateBoard(stages.find(s => (ticketsByStage[s.id] ?? []).length)?.id ?? stages[0].id);
  const stage = stages.find(s => s.id === active);
  const list = ticketsByStage[active] ?? [];
  return (
    <div className="ws-mboard">
      <div className="ws-mseg">
        {stages.map(s => (
          <button key={s.id} type="button" className={'ws-mseg-btn' + (s.id === active ? ' is-active' : '')} onClick={() => setActive(s.id)}>
            {s.name}<span className="ws-mseg-count">{(ticketsByStage[s.id] ?? []).length}</span>
          </button>
        ))}
      </div>
      <div className="ws-mboard-list">
        {list.map(t => <KanbanCard key={t.id} ticket={t} members={members} ctx={ctx} />)}
        {list.length === 0 && <EmptyState icon="table-columns" title={`Nothing in ${stage.name}`} sub="Pull tickets from GitLab to get started." />}
      </div>
    </div>
  );
}

Object.assign(window, { KanbanCard, KanbanColumn, BoardHeader, BoardDesktop, BoardMobile });
