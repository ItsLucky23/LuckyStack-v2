/* Workspaces UI kit — command palette (⌘K) + voice capture sheet. */
const { useState: useStateOv } = React;

function CommandPalette({ ctx, onClose }) {
  const [q, setQ] = useStateOv('');
  const ql = q.trim().toLowerCase();
  const tickets = window.WS_TICKETS.filter(t => !ql || t.id.toLowerCase().includes(ql) || t.title.toLowerCase().includes(ql)).slice(0, 4);
  const jumps = [
    { id: 'board', icon: 'table-columns', label: 'Board' }, { id: 'backlog', icon: 'list-check', label: 'Backlog' },
    { id: 'terminals', icon: 'terminal', label: 'Terminals' }, { id: 'pipeline', icon: 'diagram-project', label: 'Pipeline' },
  ].filter(j => !ql || j.label.toLowerCase().includes(ql));
  const actions = [
    { id: 'newticket', icon: 'plus', label: 'New ticket' }, { id: 'newterm', icon: 'terminal', label: 'New terminal' },
    { id: 'invite', icon: 'user-plus', label: 'Invite member' },
  ].filter(a => !ql || a.label.toLowerCase().includes(ql));

  return (
    <div className="ws-overlay" onClick={onClose}>
      <div className="ws-cmd" onClick={e => e.stopPropagation()}>
        <div className="ws-cmd-search"><Icon name="magnifying-glass" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search tickets, people, actions…" /><kbd>Esc</kbd></div>
        <div className="ws-cmd-list">
          {jumps.length > 0 && <div className="ws-cmd-group">Jump to</div>}
          {jumps.map(j => <button key={j.id} type="button" className="ws-cmd-item" onClick={() => { ctx.navigate(j.id); onClose(); }}><Icon name={j.icon} className="ws-cmd-ic" /> {j.label}<span className="ws-cmd-hint">↵</span></button>)}
          {tickets.length > 0 && <div className="ws-cmd-group">Tickets</div>}
          {tickets.map(t => <button key={t.id} type="button" className="ws-cmd-item" onClick={() => { ctx.openTicket(t.id); onClose(); }}><span className="ws-cmd-mono">{t.id}</span> <span className="ws-cmd-tt">{t.title}</span><StatusPill status={t.status} dot={false} /></button>)}
          {actions.length > 0 && <div className="ws-cmd-group">Actions</div>}
          {actions.map(a => <button key={a.id} type="button" className="ws-cmd-item" onClick={onClose}><Icon name={a.icon} className="ws-cmd-ic" /> {a.label}</button>)}
          {jumps.length + tickets.length + actions.length === 0 && (
            <button type="button" className="ws-cmd-item" onClick={onClose}><Icon name="plus" className="ws-cmd-ic" /> Create “{q}” as a ticket</button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceSheet({ ctx, onClose }) {
  const [phase, setPhase] = useStateOv('recording'); // recording | review
  return (
    <div className="ws-overlay is-bottom" onClick={onClose}>
      <div className="ws-sheet" onClick={e => e.stopPropagation()}>
        <div className="ws-sheet-grip" />
        {phase === 'recording' ? (
          <div className="ws-voice">
            <div className="ws-voice-wave">{Array.from({ length: 28 }).map((_, i) => <span key={i} style={{ height: 6 + Math.abs(Math.sin(i * 0.9)) * 30 + 'px' }} />)}</div>
            <div className="ws-voice-timer">0:07</div>
            <button type="button" className="ws-voice-stop" onClick={() => setPhase('review')}><Icon name="stop" /></button>
            <div className="ws-voice-hint">Listening… tap to stop</div>
          </div>
        ) : (
          <div className="ws-voice-review">
            <div className="ws-voice-label">Transcript</div>
            <textarea className="ws-textarea" defaultValue={"Create a ticket: the avatar still flickers on 3G, similar to twelve-forty."} />
            <div className="ws-field"><label>Send to</label><Dropdown value="create" items={[{ id: 'create', label: 'Create ticket' }, { id: 'reply', label: "Reply to DEV-1240's AI" }, { id: 'ai', label: 'Workspace-AI' }]} /></div>
            <div className="ws-voice-acts"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="paper-plane" onClick={onClose}>Send</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { CommandPalette, VoiceSheet });

/* Generic centered modal (mirrors MenuHandler's centered card). */
function Modal({ title, icon, size = 'md', onClose, children, footer }) {
  return (
    <div className="ws-overlay" onClick={onClose}>
      <div className={'ws-modal is-' + size} onClick={e => e.stopPropagation()}>
        <div className="ws-modal-head">
          <div className="ws-modal-title">{icon && <span className="ws-modal-ic"><Icon name={icon} /></span>}{title}</div>
          <button type="button" className="ws-iconbtn ws-iconbtn-sm" onClick={onClose}><Icon name="xmark" /></button>
        </div>
        <div className="ws-modal-body">{children}</div>
        {footer && <div className="ws-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function CreateWorkspaceModal({ onClose }) {
  const [name, setName] = useStateOv('');
  return (
    <Modal title="Create workspace" icon="plus" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="plus" onClick={onClose}>Create workspace</Button></>}>
      <p className="ws-modal-lead">A workspace is your team's tenant — members, roles, and one GitLab connection.</p>
      <div className="ws-field"><label>Workspace name</label><input className="ws-input2" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. YouComm Core" /></div>
      <div className="ws-field"><label>Slug</label><div className="ws-slugrow"><span className="ws-slugpre">workspaces.app/</span><input className="ws-input2" value={name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')} readOnly placeholder="youcomm-core" /></div></div>
      <div className="ws-field"><label>GitLab base URL</label><input className="ws-input2" defaultValue="https://gitlab.com" /></div>
      <div className="ws-field"><label>GitLab access token <span className="ws-optional">· optional, add later</span></label><input className="ws-input2" type="password" placeholder="glpat-…" /></div>
    </Modal>
  );
}

function InviteModal({ onClose }) {
  return (
    <Modal title="Invite members" icon="user-plus" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="paper-plane" onClick={onClose}>Send invites</Button></>}>
      <p className="ws-modal-lead">They'll get an email to join <strong>YouComm Core</strong>.</p>
      <div className="ws-field"><label>Email addresses</label><textarea className="ws-textarea" autoFocus placeholder={"joost@youcomm.nl\nlisa@youcomm.nl"} /></div>
      <div className="ws-field"><label>Role</label><Dropdown value="member" items={[{ id: 'admin', label: 'Admin — manage members, pipeline, sources' }, { id: 'member', label: 'Member — work on tickets' }]} /></div>
    </Modal>
  );
}

function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, input, onConfirm, onClose }) {
  const [val, setVal] = useStateOv('');
  const blocked = input ? val !== input : false;
  return (
    <Modal title={title} icon={danger ? 'triangle-exclamation' : 'circle-question'} size="sm" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { if (!blocked) { onConfirm?.(); onClose(); } }}>{confirmLabel}</Button></>}>
      {body && <p className="ws-modal-lead">{body}</p>}
      {input && (
        <div className="ws-field"><label>Type <span className="ws-code-inline">{input}</span> to confirm</label><input className="ws-input2" autoFocus value={val} onChange={e => setVal(e.target.value)} /></div>
      )}
    </Modal>
  );
}

Object.assign(window, { Modal, CreateWorkspaceModal, InviteModal, ConfirmDialog });

/* Notification center — right slide-in panel (desktop) / bottom sheet (mobile). */
function NotificationCenter({ ctx, onClose }) {
  const [filter, setFilter] = useStateOv('all');
  const [items, setItems] = useStateOv(window.WS_NOTIFICATIONS);
  const shown = filter === 'all' ? items : items.filter(n => n.type === filter);
  const markAll = () => setItems(items.map(n => ({ ...n, read: true })));
  return (
    <div className="ws-overlay is-right" onClick={onClose}>
      <div className="ws-notif" onClick={e => e.stopPropagation()}>
        <div className="ws-notif-head">
          <div className="ws-modal-title"><Icon name="bell" className="ws-dd-leadicon" /> Notifications</div>
          <div className="ws-notif-headr"><button type="button" className="ws-txtbtn" onClick={markAll}>Mark all read</button><button type="button" className="ws-iconbtn ws-iconbtn-sm" onClick={onClose}><Icon name="xmark" /></button></div>
        </div>
        <div className="ws-notif-filters">
          {[['all','All'],['needs-input','Needs input'],['merge','Merges'],['ai','AI'],['failure','Failures']].map(([id,l]) => (
            <button key={id} type="button" className={'ws-notif-fb' + (filter===id?' is-on':'')} onClick={() => setFilter(id)}>{l}</button>
          ))}
        </div>
        <div className="ws-notif-list">
          {shown.map(n => { const m = window.WS_NOTIF_META[n.type]; return (
            <button key={n.id} type="button" className={'ws-notif-item' + (n.read?'':' is-unread')} onClick={() => { ctx.openTicket(n.ticket); onClose(); }}>
              <span className="ws-notif-ic" style={{ background: m.bg, color: m.color }}><Icon name={m.icon} /></span>
              <div className="ws-notif-main"><div className="ws-notif-title">{n.title}</div><div className="ws-notif-body">{n.body}</div><div className="ws-notif-meta"><span className="ws-notif-tk">{n.ticket}</span> · {n.time}</div></div>
              {!n.read && <span className="ws-notif-dot" />}
            </button>
          ); })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NotificationCenter });

function CreateTicketModal({ onClose }) {
  return (
    <Modal title="New ticket" icon="plus" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="plus" onClick={onClose}>Create ticket</Button></>}>
      <div className="ws-field"><label>Title</label><input className="ws-input2" autoFocus placeholder="What needs doing?" /></div>
      <div className="ws-field"><label>Description</label><textarea className="ws-textarea" placeholder="Context, acceptance criteria…" /></div>
      <div className="ws-set-row2">
        <div className="ws-field"><label>Stage</label><Dropdown value="unrefined" items={window.WS_STAGES.map(s => ({ id: s.id, label: s.name }))} /></div>
        <div className="ws-field"><label>Sprint</label><Dropdown value="s24" items={window.WS_SPRINTS.map(s => ({ id: s.id, label: s.name }))} /></div>
      </div>
      <div className="ws-set-row2">
        <div className="ws-field"><label>Assignee</label><Dropdown value="ai" items={[{ id: 'ai', label: 'AI agent' }, { id: 'mathijs', label: 'Mathijs' }, { id: 'sanne', label: 'Sanne' }]} /></div>
        <div className="ws-field"><label>Labels</label><MultiSelectDropdownStub /></div>
      </div>
    </Modal>
  );
}
function MultiSelectDropdownStub() {
  return <Dropdown value="bug" items={[{ id: 'bug', label: 'bug' }, { id: 'feature', label: 'feature' }, { id: 'frontend', label: 'frontend' }, { id: 'backend', label: 'backend' }]} />;
}

Object.assign(window, { CreateTicketModal });
