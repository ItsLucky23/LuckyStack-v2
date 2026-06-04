/* Workspaces UI kit — settings (account) + workspace/org admin. */
const { useState: useStateSet } = React;

function SettingsScreen({ ctx, initialScope = 'account', initialTab }) {
  const [scope, setScope] = useStateSet(initialScope);
  return (
    <div className="ws-screen ws-settings">
      <ScreenHead title={scope === 'workspace' ? 'Workspace' : 'Settings'} sub={scope === 'workspace' ? 'YouComm Core' : null}>
        <Segmented value={scope} onChange={setScope} options={[{ id: 'account', label: 'Account' }, { id: 'workspace', label: 'Workspace' }]} />
      </ScreenHead>
      <div className="ws-set-wrap">
        {scope === 'account' ? <AccountSettings ctx={ctx} /> : <WorkspaceSettings ctx={ctx} initialTab={initialTab} />}
      </div>
    </div>
  );
}

function AccountSettings({ ctx }) {
  const me = ctx.me;
  const [theme, setThemeLocal] = useStateSet(ctx.theme);
  return (
    <div className="ws-set-col">
      <SectionCard title="Profile">
        <div className="ws-set-profile">
          <div className="ws-set-avatar"><Avatar user={me} size={56} fontSize={22} /></div>
          <div className="ws-set-fields">
            <div className="ws-field"><label>Name</label><input className="ws-input2" defaultValue={me.name} /></div>
            <div className="ws-field"><label>Email</label><input className="ws-input2" defaultValue="mathijs@youcomm.nl" readOnly /></div>
          </div>
        </div>
        <div className="ws-set-row2">
          <div className="ws-field"><label>Theme</label><Segmented size="sm" value={ctx.theme} onChange={ctx.setTheme} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} /></div>
          <div className="ws-field"><label>Language</label><Dropdown value="en" items={[{ id: 'en', label: 'English' }, { id: 'nl', label: 'Nederlands' }, { id: 'de', label: 'Deutsch' }, { id: 'fr', label: 'Français' }]} /></div>
        </div>
      </SectionCard>

      <SectionCard title="Connections">
        <div className="ws-conn"><span className="ws-conn-l"><Icon name="code-branch" className="ws-conn-ic" /> GitLab <span className="ws-rolechip">primary</span></span><span className="ws-conn-ok"><Icon name="circle-check" /> Connected</span></div>
        <div className="ws-conn"><span className="ws-conn-l"><Icon name="code-branch" className="ws-conn-ic" /> GitHub</span><button type="button" className="ws-txtbtn">Connect</button></div>
      </SectionCard>

      <SectionCard title="SSH keys" desc="Required to open terminals." right={<Button variant="secondary" icon="plus" onClick={() => ctx.openModal('addKey')}>Add key</Button>}>
        {window.WS_SSH_KEYS.map(k => (
          <div key={k.id} className="ws-keyrow">
            <Icon name="key" className="ws-keyrow-ic" />
            <div className="ws-keyrow-main"><div className="ws-keyrow-name">{k.name} <span className="ws-chip2">{k.type}</span></div><div className="ws-keyrow-fp ws-code-inline">{k.fp}</div></div>
            <div className="ws-keyrow-meta">added {k.added} · used {k.last}</div>
            <button type="button" className="ws-txtbtn is-danger"><Icon name="trash-can" /></button>
          </div>
        ))}
        <div className="ws-keyrow-badge"><Icon name="circle-check" /> Terminal access enabled</div>
      </SectionCard>

      <SectionCard title="Sessions">
        {window.WS_SESSIONS.map(s => (
          <div key={s.id} className="ws-sessrow">
            <Icon name={s.device.includes('iPhone') ? 'mobile-screen' : 'laptop'} className="ws-keyrow-ic" />
            <div className="ws-keyrow-main"><div className="ws-keyrow-name">{s.device} {s.current && <span className="ws-chip2 is-live">this device</span>}</div><div className="ws-keyrow-meta">{s.loc} · {s.last}</div></div>
            {!s.current && <button type="button" className="ws-txtbtn is-danger" onClick={() => ctx.openModal('confirm', { title: `Revoke ${s.device}?`, body: 'That device will be signed out immediately.', confirmLabel: 'Revoke', danger: true })}>Revoke</button>}
          </div>
        ))}
        <div className="ws-dangerrow" style={{ borderBottom: 'none' }}><div><div className="ws-keyrow-name">Other sessions</div><div className="ws-keyrow-meta">Sign out everywhere except this device.</div></div><Button variant="secondary" onClick={() => ctx.openModal('confirm', { title: 'Revoke all other sessions?', confirmLabel: 'Revoke all', danger: true })}>Revoke all others</Button></div>
      </SectionCard>

      <SectionCard title="Notifications &amp; data">
        <div className="ws-conn"><span className="ws-conn-l"><Icon name="bell" className="ws-conn-ic" /> Web push</span><span className="ws-conn-ok"><Icon name="circle-check" /> Enabled</span></div>
        <div className="ws-conn"><span className="ws-conn-l"><Icon name="download" className="ws-conn-ic" /> Download my data</span><Button variant="secondary" onClick={() => ctx.openModal('confirm', { title: 'Export your data?', body: 'We\u2019ll email you a link to a JSON export of your account.', confirmLabel: 'Request export' })}>Export</Button></div>
      </SectionCard>
    </div>
  );
}

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const PERMISSIONS = [
  { cap: 'View board & tickets',        owner: true, admin: true,  member: true },
  { cap: 'Create & edit tickets',       owner: true, admin: true,  member: true },
  { cap: 'Open terminals',              owner: true, admin: true,  member: true },
  { cap: 'Edit pipeline & stages',      owner: true, admin: true,  member: false },
  { cap: 'Manage sources & skills',     owner: true, admin: true,  member: false },
  { cap: 'Invite & remove members',     owner: true, admin: true,  member: false },
  { cap: 'Manage GitLab integration',   owner: true, admin: true,  member: false },
  { cap: 'Change member roles',         owner: true, admin: false, member: false },
  { cap: 'Transfer / delete workspace', owner: true, admin: false, member: false },
];

function WorkspaceSettings({ ctx, initialTab = 'members' }) {
  const [tab, setTab] = useStateSet(initialTab);
  const members = Object.values(ctx.members);
  const changeRole = (m, role) => ctx.openModal('confirm', {
    title: `Make ${m.name} ${ROLE_LABELS[role]}?`,
    body: `${m.name} will have ${ROLE_LABELS[role]} permissions in YouComm Core.`,
    confirmLabel: `Make ${ROLE_LABELS[role]}`,
  });
  const removeMember = (m) => ctx.openModal('confirm', {
    title: `Remove ${m.name}?`,
    body: `${m.name} will lose access to YouComm Core and all its projects.`,
    confirmLabel: 'Remove member', danger: true, input: m.name,
  });
  return (
    <div className="ws-set-col">
      <Tabs tabs={[{ id: 'members', label: 'Members', count: members.length }, { id: 'permissions', label: 'Permissions' }, { id: 'invites', label: 'Invites', count: window.WS_PENDING_INVITES.length }, { id: 'integrations', label: 'Integrations' }, { id: 'danger', label: 'Danger' }]} active={tab} onChange={setTab} />
      {tab === 'members' && (
        <SectionCard title="Members" desc="YouComm Core" right={<Button icon="user-plus" onClick={() => ctx.openModal('invite')}>Invite</Button>}>
          {members.map(m => {
            const role = m.role.toLowerCase();
            return (
              <div key={m.id} className="ws-memrow">
                <Avatar user={m} size={32} />
                <div className="ws-memrow-main"><div className="ws-keyrow-name">{m.name} {m.id === ctx.me.id && <span className="ws-chip2">you</span>}</div><div className="ws-keyrow-meta">{m.id}@youcomm.nl</div></div>
                <span className={'ws-rolechip is-' + role}>{m.role}</span>
                <PopMenu items={[
                  { label: 'Make Owner', icon: 'crown', onClick: () => changeRole(m, 'owner') },
                  { label: 'Make Admin', icon: 'user-shield', onClick: () => changeRole(m, 'admin') },
                  { label: 'Make Member', icon: 'user', onClick: () => changeRole(m, 'member') },
                  { divider: true },
                  { label: 'Remove from workspace', icon: 'user-minus', danger: true, onClick: () => removeMember(m) },
                ]} />
              </div>
            );
          })}
        </SectionCard>
      )}
      {tab === 'permissions' && (
        <SectionCard title="Roles & permissions" desc="What each role can do in this workspace.">
          <div className="ws-permtable">
            <div className="ws-permhead"><span>Capability</span><span>Owner</span><span>Admin</span><span>Member</span></div>
            {PERMISSIONS.map((p, i) => (
              <div key={i} className="ws-permrow">
                <span className="ws-permcap">{p.cap}</span>
                {['owner','admin','member'].map(r => (
                  <span key={r} className="ws-permcell">{p[r] ? <span className="ws-permyes">✓</span> : <span className="ws-permno">—</span>}</span>
                ))}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
      {tab === 'invites' && (
        <SectionCard title="Pending invites" right={<Button icon="user-plus" onClick={() => ctx.openModal('invite')}>Invite</Button>}>
          {window.WS_PENDING_INVITES.map(i => (
            <div key={i.id} className="ws-memrow">
              <span className="ws-invite-ic"><Icon name="envelope" /></span>
              <div className="ws-memrow-main"><div className="ws-keyrow-name">{i.email}</div><div className="ws-keyrow-meta">{i.role} · sent {i.sent}</div></div>
              <button type="button" className="ws-txtbtn">Resend</button>
              <button type="button" className="ws-txtbtn is-danger">Revoke</button>
            </div>
          ))}
        </SectionCard>
      )}
      {tab === 'integrations' && (
        <SectionCard title="GitLab" desc="This workspace syncs with GitLab.">
          <div className="ws-field"><label>Access token</label><div className="ws-tokenrow"><input className="ws-input2" type="password" defaultValue="glpat-xxxxxxxxxxxx" /><Button variant="secondary">Verify</Button></div></div>
          <div className="ws-conn-ok" style={{ marginTop: 8 }}><Icon name="circle-check" /> Connected · youcomm/app</div>
        </SectionCard>
      )}
      {tab === 'danger' && (
        <SectionCard title="Danger zone">
          <div className="ws-dangerrow"><div><div className="ws-keyrow-name">Transfer ownership</div><div className="ws-keyrow-meta">Hand this workspace to another owner.</div></div><Button variant="secondary" onClick={() => ctx.openModal('confirm', { title: 'Transfer ownership?', body: 'You will become an Admin. The new owner gets full control.', confirmLabel: 'Transfer', danger: true, input: 'YouComm Core' })}>Transfer</Button></div>
          <div className="ws-dangerrow"><div><div className="ws-keyrow-name">Delete workspace</div><div className="ws-keyrow-meta">Permanent. Type the name to confirm.</div></div><Button variant="danger" onClick={() => ctx.openModal('confirm', { title: 'Delete workspace?', body: 'This permanently deletes YouComm Core, its members and pipeline config.', confirmLabel: 'Delete workspace', danger: true, input: 'YouComm Core' })}>Delete</Button></div>
        </SectionCard>
      )}
    </div>
  );
}

Object.assign(window, { SettingsScreen });
