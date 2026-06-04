/* Workspaces UI kit — sources & skills screen. */
const { useState: useStateSrc } = React;

function DocCard({ doc, ctx }) {
  const icon = doc.source === 'uploaded' ? 'file-arrow-up' : doc.source === 'generated' ? 'wand-magic-sparkles' : 'file-lines';
  return (
    <div className="ws-srccard">
      <div className="ws-srccard-top">
        <span className="ws-srccard-ic"><Icon name={icon} /></span>
        <div className="ws-srccard-name">{doc.name}</div>
      </div>
      <div className="ws-srccard-meta">
        <span className="ws-chip2">{doc.source}</span>
        <span className="ws-srccard-note">{doc.note}</span>
      </div>
      <div className="ws-srccard-foot">
        <span className="ws-srccard-upd">Updated {doc.updated}</span>
        <div className="ws-srccard-acts">
          <button type="button" className="ws-txtbtn" onClick={() => ctx.openModal('sourcePreview', { doc })}><Icon name="eye" /> Preview</button>
          {doc.source === 'generated' && <button type="button" className="ws-txtbtn"><Icon name="rotate" /> Regenerate</button>}
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill, onToggle, ctx }) {
  return (
    <div className={'ws-srccard' + (skill.on ? '' : ' is-off')}>
      <div className="ws-srccard-top">
        <span className="ws-srccard-ic"><Icon name={skill.type === 'frozen' ? 'snowflake' : 'bolt'} /></span>
        <div className="ws-srccard-name">{skill.name}</div>
        <Toggle on={skill.on} onChange={() => onToggle(skill.id)} />
      </div>
      <div className="ws-srccard-meta">
        <span className={'ws-chip2 ' + (skill.type === 'frozen' ? 'is-frozen' : 'is-live')}>{skill.type === 'frozen' ? 'frozen @ commit' : 'live'}</span>
        <span className="ws-srccard-note">{skill.status}</span>
      </div>
      <div className="ws-srccard-foot">
        {skill.model && <span className="ws-srccard-upd">{skill.model}</span>}
        <div className="ws-srccard-acts">
          <button type="button" className="ws-txtbtn" onClick={() => ctx.openModal('skill', { skill })}><Icon name="circle-info" /> Details</button>
          <button type="button" className="ws-txtbtn" onClick={() => ctx.openModal('confirm', { title: `Reindex ${skill.name.split(' · ')[0]}?`, body: 'Rebuilds the index for the current commit. Takes a few minutes.', confirmLabel: 'Reindex' })}><Icon name="arrows-rotate" /> Reindex</button>
        </div>
      </div>
    </div>
  );
}

function SourcesScreen({ ctx }) {
  const [tab, setTab] = useStateSrc('docs');
  const [skills, setSkills] = useStateSrc(window.WS_SKILLS);
  const toggle = (id) => setSkills(s => s.map(k => k.id === id ? { ...k, on: !k.on } : k));
  return (
    <div className="ws-screen">
      <ScreenHead title="Sources" sub="context & skills">
        <Button variant="secondary" icon="arrows-rotate">{ctx.isMobile ? '' : 'Reindex all'}</Button>
        <Button icon="upload" onClick={() => ctx.openModal('upload')}>{ctx.isMobile ? '' : 'Upload spec'}</Button>
      </ScreenHead>
      <div className="ws-banner is-ok ws-banner-thin">
        <Icon name="circle-check" /><div><strong>Index healthy</strong> — frozen stores up to date with <span className="ws-code-inline">abc123</span>.</div>
      </div>
      <Tabs tabs={[{ id: 'docs', label: 'Context docs', count: window.WS_DOCS.length }, { id: 'skills', label: 'Skills / MCP', count: skills.length }]} active={tab} onChange={setTab} />
      <div className="ws-srcgrid">
        {tab === 'docs' && window.WS_DOCS.map(d => <DocCard key={d.id} doc={d} ctx={ctx} />)}
        {tab === 'skills' && skills.map(s => <SkillCard key={s.id} skill={s} onToggle={toggle} ctx={ctx} />)}
      </div>
    </div>
  );
}

Object.assign(window, { SourcesScreen });
