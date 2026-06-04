/* Workspaces UI kit — Wave 2–4 overlays: sprints, budget, reference picker,
   promote, quickview, context-menu, board filter, suggestion/skill/source detail,
   add-ssh-key, upload-spec. All reuse Modal / slide-in / bottom-sheet patterns. */
const { useState: useStateOv2 } = React;

/* --- Sheet (right slide-in desktop / bottom sheet mobile), bigger than Modal --- */
function Sheet({ title, icon, onClose, children, footer, size = 'md' }) {
  return (
    <div className="ws-overlay is-right" onClick={onClose}>
      <div className={'ws-sheetpanel is-' + size} onClick={e => e.stopPropagation()}>
        <div className="ws-notif-head">
          <div className="ws-modal-title">{icon && <Icon name={icon} className="ws-dd-leadicon" />}{title}</div>
          <button type="button" className="ws-iconbtn ws-iconbtn-sm" onClick={onClose}><Icon name="xmark" /></button>
        </div>
        <div className="ws-sheet-body">{children}</div>
        {footer && <div className="ws-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* --- Sprint create/edit modal --- */
function SprintModal({ onClose }) {
  return (
    <Modal title="New sprint" icon="calendar-day" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="check" onClick={onClose}>Create sprint</Button></>}>
      <div className="ws-field"><label>Name</label><input className="ws-input2" autoFocus defaultValue="Sprint 25" /></div>
      <div className="ws-set-row2">
        <div className="ws-field"><label>Start date</label><input className="ws-input2" type="date" defaultValue="2026-06-10" /></div>
        <div className="ws-field"><label>End date</label><input className="ws-input2" type="date" defaultValue="2026-06-23" /></div>
      </div>
    </Modal>
  );
}

/* --- Sprint manager --- */
function SprintsManager({ ctx, onClose }) {
  return (
    <Sheet title="Sprints" icon="calendar-day" onClose={onClose}
      footer={<Button icon="plus" onClick={() => ctx.openModal('sprint')}>New sprint</Button>}>
      {window.WS_SPRINTS.map(s => (
        <div key={s.id} className="ws-memrow">
          <div className="ws-memrow-main"><div className="ws-keyrow-name">{s.name} {s.active && <span className="ws-chip2 is-live">active</span>}</div>
            <div className="ws-keyrow-meta">{s.start ? `${s.start} – ${s.end}` : 'No dates'}{s.daysLeft ? ` · ${s.daysLeft} days left` : ''} · {s.count} tickets</div></div>
          <PopMenu items={[{ label: 'Edit', icon: 'pen', onClick: () => ctx.openModal('sprint') }, { divider: true }, { label: 'Delete', icon: 'trash-can', danger: true }]} />
        </div>
      ))}
    </Sheet>
  );
}

/* --- Budget cap reached --- */
function BudgetCapModal({ ctx, onClose }) {
  return (
    <Modal title="Budget cap reached" icon="triangle-exclamation" size="sm" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Resume anyway</Button><Button onClick={() => { ctx.navigate('usage'); onClose(); }}>Raise cap</Button></>}>
      <p className="ws-modal-lead">All agents are <strong>auto-paused</strong> — this month's spend hit the {window.WS_BUDGET.currency}{window.WS_BUDGET.cap} cap. Raise the cap or resume manually.</p>
    </Modal>
  );
}

/* --- Reference picker (Files / Tickets / MRs / Sources) --- */
function ReferencePicker({ ctx, onClose }) {
  const [tab, setTab] = useStateOv2('files');
  const files = ['src/_components/Avatar.tsx', 'src/_providers/avatarProvider.tsx', 'src/_components/Dropdown.tsx', 'src/limiter.ts'];
  return (
    <Sheet title="Add reference" icon="link" onClose={onClose} size="lg">
      <div className="ws-cmd-search" style={{ border: 'none', padding: '0 0 10px' }}><Icon name="magnifying-glass" /><input placeholder="Search the worktree…" autoFocus /></div>
      <Tabs tabs={[{ id: 'files', label: 'Files' }, { id: 'tickets', label: 'Tickets' }, { id: 'mrs', label: 'MRs' }, { id: 'sources', label: 'Sources' }]} active={tab} onChange={setTab} />
      <div className="ws-ref-list">
        {tab === 'files' && files.map(f => (
          <div key={f} className="ws-file"><Icon name="file-code" className="ws-file-ic" /><span className="ws-file-path">{f}</span><Button variant="secondary">Reference</Button></div>
        ))}
        {tab === 'tickets' && window.WS_TICKETS.slice(0, 5).map(t => (
          <div key={t.id} className="ws-linkrow" style={{ cursor: 'default' }}><span className="ws-linkrow-id">{t.id}</span><span className="ws-linkrow-t">{t.title}</span>
            <Dropdown value="relates" items={[{ id: 'relates', label: 'relates to' }, { id: 'blocks', label: 'blocks' }, { id: 'dup', label: 'duplicates' }]} /></div>
        ))}
        {tab === 'mrs' && <EmptyState icon="code-merge" title="No open MRs match" />}
        {tab === 'sources' && window.WS_DOCS.slice(0, 4).map(d => (
          <div key={d.id} className="ws-file"><Icon name="file-lines" className="ws-file-ic" /><span className="ws-file-path">{d.name}</span><Button variant="secondary">Reference</Button></div>
        ))}
      </div>
    </Sheet>
  );
}

/* --- Promote to next stage preview --- */
function PromotePreview({ ctx, onClose, ticket }) {
  return (
    <Modal title="Promote to next stage" icon="circle-arrow-right" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="circle-arrow-right" onClick={onClose}>Promote to Test</Button></>}>
      <p className="ws-modal-lead">Implementatie → <strong>Test</strong>. This carry-over will be injected as the next stage's start-prompt:</p>
      <div className="ws-prompt-preview"><pre className="ws-pre">Summary: avatar flicker fixed via shared status map.{'\n'}Changed files: Avatar.tsx (+12 −4), avatarProvider.tsx (+28 −2){'\n'}Open questions: none{'\n'}Base commit: abc123</pre></div>
    </Modal>
  );
}

/* --- Ticket quickview (from board card) --- */
function TicketQuickview({ ctx, onClose, id }) {
  const t = window.WS_TICKETS.find(x => x.id === id); if (!t) return null;
  const stage = window.WS_STAGES.find(s => s.id === t.stage);
  return (
    <Sheet title={id} icon="ticket" onClose={onClose}
      footer={<Button icon="up-right-from-square" onClick={() => { ctx.openTicket(id); onClose(); }}>Open full ticket</Button>}>
      <h2 className="ws-qv-title">{t.title}</h2>
      <div className="ws-qv-meta"><span className="ws-badge-stage">{stage.name}</span><StatusPill status={t.status} />{window.WS_TICKET_COST[id] && <span className="ws-cost-chip">{window.WS_TICKET_COST[id]}</span>}</div>
      <div className="ws-field"><label>Status</label><Dropdown value={t.status} items={[{ id: 'busy', label: 'Busy' }, { id: 'needs-input', label: 'Needs input' }, { id: 'done', label: 'Done' }]} /></div>
      <div className="ws-field"><label>Move to stage</label><Dropdown value={t.stage} items={window.WS_STAGES.map(s => ({ id: s.id, label: s.name }))} /></div>
      <div className="ws-qv-actions">
        <Button variant="secondary" icon="terminal" onClick={() => { ctx.navigate('terminals'); onClose(); }}>Open terminal</Button>
        <Button variant="secondary" icon="up-right-from-square">Open in GitLab</Button>
        <Button variant="secondary" icon="pause">Pause agent</Button>
      </div>
    </Sheet>
  );
}

/* --- Board filter popover --- */
function BoardFilter({ onClose }) {
  return (
    <Sheet title="Filter board" icon="filter" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Clear</Button><Button onClick={onClose}>Apply</Button></>}>
      <div className="ws-flabel">Labels</div>
      <div className="ws-chiprow">{['bug','feature','frontend','backend','auth','mobile'].map(l => <span key={l} className="ws-vchip">{l}</span>)}</div>
      <div className="ws-flabel" style={{ marginTop: 12 }}>Status</div>
      <div className="ws-chiprow">{['needs input','busy','done'].map(l => <span key={l} className="ws-vchip">{l}</span>)}</div>
      <div style={{ marginTop: 12 }}><Toggle on={false} label="Has running terminal" onChange={() => {}} /><Toggle on={false} label="Needs input only" onChange={() => {}} /></div>
    </Sheet>
  );
}

/* --- Suggestion detail (AI) --- */
function SuggestionDetail({ ctx, onClose, suggestion }) {
  const s = suggestion;
  return (
    <Sheet title="Suggestion" icon="robot" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Dismiss</Button><Button icon="check" onClick={onClose}>Accept</Button></>}>
      <h2 className="ws-qv-title">{s.title}</h2>
      <p className="ws-prose">{s.body}</p>
      <div className="ws-ai-card-tickets" style={{ marginTop: 10 }}>{s.tickets.map(t => <button key={t} type="button" className="ws-ai-tk" onClick={() => { ctx.openTicket(t); onClose(); }}>{t}</button>)}</div>
      <div className="ws-banner is-ok ws-banner-thin" style={{ margin: '14px 0 0' }}><Icon name="wand-magic-sparkles" /><div>Accepting will create a <strong>secrets</strong> epic and link {s.tickets.join(', ')}.</div></div>
      <div className="ws-field" style={{ marginTop: 12 }}><label>Snooze</label><Dropdown value="none" items={[{ id: 'none', label: "Don't snooze" }, { id: '1h', label: '1 hour' }, { id: 'tom', label: 'Tomorrow' }]} /></div>
    </Sheet>
  );
}

/* --- Skill / MCP detail --- */
function SkillDetail({ onClose, skill }) {
  return (
    <Modal title={skill?.name ?? 'Skill'} icon="bolt" size="sm" onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}>
      <p className="ws-modal-lead">On-demand capability the agent can call during a stage.</p>
      <div className="ws-kv"><span>Type</span><span className={'ws-chip2 ' + (skill?.type === 'frozen' ? 'is-frozen' : 'is-live')}>{skill?.type}</span></div>
      <div className="ws-kv"><span>Status</span><span className="ws-kv-v">{skill?.status}</span></div>
      <div className="ws-kv"><span>Used by stages</span><span className="ws-kv-v">Plan, Implementatie, Review</span></div>
    </Modal>
  );
}

/* --- Source preview --- */
function SourcePreview({ onClose, doc }) {
  return (
    <Sheet title={doc?.name ?? 'Source'} icon="file-lines" onClose={onClose} size="lg">
      <div className="ws-prompt-preview"><pre className="ws-pre"># {doc?.name}{'\n\n'}## Overview{'\n'}youcomm-app is a LuckyStack monorepo. Frontend in src/, backend in api/.{'\n\n'}## Conventions{'\n'}- Components live in src/_components, one file each.{'\n'}- Tokens: container1/2, title/common/muted, primary/correct/warning/wrong.{'\n'}- All strings are translator keys.</pre></div>
      <div className="ws-kv" style={{ marginTop: 12 }}><span>Frozen at</span><span className="ws-code-inline">abc123</span></div>
    </Sheet>
  );
}

/* --- Upload spec --- */
function UploadSpec({ onClose }) {
  return (
    <Sheet title="Upload spec" icon="upload" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="upload" onClick={onClose}>Upload</Button></>}>
      <div className="ws-dropzone"><Icon name="cloud-arrow-up" /><div>Drag a markdown spec here, or click to browse</div></div>
      <div className="ws-field" style={{ marginTop: 12 }}><label>Name</label><input className="ws-input2" placeholder="Auth redesign.md" /></div>
    </Sheet>
  );
}

/* --- Add SSH key --- */
function AddSshKey({ onClose }) {
  const [phase, setPhase] = useStateOv2('idle');
  return (
    <Sheet title="Add SSH key" icon="key" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={phase === 'ok' ? 'circle-check' : null} onClick={() => { setPhase('verifying'); setTimeout(() => { setPhase('ok'); setTimeout(onClose, 700); }, 1000); }}>{phase === 'verifying' ? 'Verifying…' : phase === 'ok' ? 'Added' : 'Verify & add'}</Button></>}>
      <p className="ws-modal-lead">Your private key stays on your device; we store only the public half.</p>
      <div className="ws-field"><label>Public key</label><textarea className="ws-textarea" placeholder="ssh-ed25519 AAAA… you@machine" autoFocus /></div>
      <div className="ws-field"><label>Key name</label><input className="ws-input2" placeholder="Work laptop" /></div>
    </Sheet>
  );
}

Object.assign(window, { Sheet, SprintModal, SprintsManager, BudgetCapModal, ReferencePicker, PromotePreview, TicketQuickview, BoardFilter, SuggestionDetail, SkillDetail, SourcePreview, UploadSpec, AddSshKey });
