/* Workspaces UI kit — pipeline / stage editor screen. */
const { useState: useStatePipe } = React;

const DOC_NAMES = Object.fromEntries(window.WS_DOCS.map(d => [d.id, d.name]));
const SKILL_NAMES = Object.fromEntries(window.WS_SKILLS.map(s => [s.id, s.name.split(' · ')[0]]));

function PipelineScreen({ ctx }) {
  const stages = window.WS_PIPELINE;
  const [sel, setSel] = useStatePipe('plan');
  const [cfgTab, setCfgTab] = useStatePipe('context');
  const stage = stages.find(s => s.id === sel);
  const stageNames = Object.fromEntries(stages.map(s => [s.id, s.name]));

  return (
    <div className="ws-screen">
      <ScreenHead title="Pipeline" sub="youcomm-app">
        <Button variant="secondary" icon="wand-magic-sparkles">{ctx.isMobile ? '' : 'Validate with AI'}</Button>
        <Button icon="plus">{ctx.isMobile ? '' : 'Stage'}</Button>
      </ScreenHead>

      <div className="ws-flow">
        {stages.map((s, i) => (
          <React.Fragment key={s.id}>
            <button type="button" className={'ws-flow-stage' + (s.id === sel ? ' is-sel' : '') + (s.ai ? '' : ' is-noai')} onClick={() => setSel(s.id)}>
              <span className="ws-flow-n">{i + 1}</span>
              <span className="ws-flow-name">{s.name}</span>
              <span className="ws-flow-ai">{s.ai ? <Icon name="robot" /> : 'no AI'}</span>
            </button>
            {i < stages.length - 1 && <Icon name="angle-right" className="ws-flow-arrow" />}
          </React.Fragment>
        ))}
      </div>

      <div className="ws-cfg">
        <div className="ws-cfg-head">
          <div className="ws-cfg-title"><span className="ws-flow-n">{stages.findIndex(s => s.id === sel) + 1}</span> {stage.name}</div>
          <button type="button" className="ws-txtbtn is-danger"><Icon name="trash-can" /> Delete</button>
        </div>
        <Tabs tabs={[
          { id: 'general', label: 'General' }, { id: 'context', label: 'Context & skills' },
          { id: 'commands', label: 'Commands' }, { id: 'access', label: 'Tool access' },
          { id: 'visibility', label: 'Visibility' }, { id: 'process', label: 'Process' },
          { id: 'prompt', label: 'Prompt-injection' }, { id: 'model', label: 'Model & effort' },
          { id: 'sandbox', label: 'Sandbox' }, { id: 'hooks', label: 'Hooks' },
        ]} active={cfgTab} onChange={setCfgTab} />

        <div className="ws-cfg-body">
          {cfgTab === 'general' && (
            <SectionCard>
              <Toggle on={stage.ai} label="AI enabled" onChange={() => {}} />
              <label className="ws-flabel">Custom instructions</label>
              <textarea className="ws-textarea" defaultValue={"Plan the change. Produce a step list and the files you expect to touch. Do not write code."} />
              <label className="ws-flabel">Statuses</label>
              <div className="ws-chiprow"><span className="ws-pill" style={{ background: 'rgba(224,146,10,.13)', color: 'var(--warning)' }}>needs input</span><span className="ws-pill" style={{ background: 'rgba(59,130,246,.12)', color: 'var(--primary)' }}>busy</span><span className="ws-pill" style={{ background: 'rgba(22,163,74,.13)', color: 'var(--correct)' }}>done</span></div>
            </SectionCard>
          )}
          {cfgTab === 'context' && (
            <div className="ws-cfg-cols">
              <SectionCard title="Context docs" desc="Frozen at the ticket's commit.">
                {window.WS_DOCS.map(d => (
                  <Toggle key={d.id} on={stage.docs.includes(d.id)} label={d.name} onChange={() => {}} />
                ))}
              </SectionCard>
              <SectionCard title="Skills / MCP" desc="On-demand capabilities for the agent.">
                {window.WS_SKILLS.map(s => (
                  <Toggle key={s.id} on={stage.skills.includes(s.id)} label={SKILL_NAMES[s.id]} onChange={() => {}} />
                ))}
              </SectionCard>
            </div>
          )}
          {cfgTab === 'commands' && (
            <SectionCard title="Whitelisted commands" desc="Still gated by the .claude accept-flow." right={<Button variant="secondary" icon="plus">Add</Button>}>
              {['npm run test','npm run lint','git status','git diff'].map(c => (
                <div key={c} className="ws-cmdrow"><span className="ws-code-inline">{c}</span><button type="button" className="ws-txtbtn"><Icon name="xmark" /></button></div>
              ))}
            </SectionCard>
          )}
          {cfgTab === 'access' && (
            <SectionCard title="Tool access">
              <div className="ws-accessrow"><span><Icon name="database" /> Mongo</span><Segmented size="sm" value={stage.mongo} onChange={() => {}} options={[{ id: 'ro', label: 'Read-only' }, { id: 'rw', label: 'Read-write' }]} /></div>
              <div className="ws-accessrow"><span><Icon name="database" /> Redis</span><Segmented size="sm" value={stage.redis} onChange={() => {}} options={[{ id: 'ro', label: 'Read-only' }, { id: 'rw', label: 'Read-write' }]} /></div>
              {stage.mongo === 'rw' && <div className="ws-banner is-warn ws-banner-thin"><Icon name="triangle-exclamation" /><div>Read-write on a non-final stage — double-check this is intended.</div></div>}
            </SectionCard>
          )}
          {cfgTab === 'visibility' && (
            <SectionCard title="Visible to stages" desc="Which later stages can read this stage's output.">
              <div className="ws-chiprow">{stages.filter(s => s.id !== sel).map(s => (
                <span key={s.id} className={'ws-vchip' + (stage.visible.includes(s.id) ? ' is-on' : '')}>{stage.visible.includes(s.id) && <Icon name="check" />} {s.name}</span>
              ))}</div>
            </SectionCard>
          )}
          {cfgTab === 'process' && (
            <SectionCard title="Process terminals" desc="Ordered terminals × commands started for this stage." right={<Button variant="secondary" icon="plus">Terminal</Button>}>
              <div className="ws-procrow"><span className="ws-proc-t">T1</span><span className="ws-code-inline">npm run server</span></div>
              <div className="ws-procrow"><span className="ws-proc-t">T2</span><span className="ws-code-inline">npm run client</span></div>
              <div className="ws-procrow"><span className="ws-proc-t">T3</span><span className="ws-code-inline">claude</span></div>
            </SectionCard>
          )}
          {cfgTab === 'prompt' && (
            <SectionCard title="Carry-over / prompt-injection" desc="Template injected as the start-prompt for the next stage.">
              <div className="ws-chiprow">{['{{summary}}','{{changedFiles}}','{{openQuestions}}','{{commitHash}}'].map(c => <span key={c} className="ws-vchip is-on"><Icon name="code" /> {c}</span>)}</div>
              <textarea className="ws-textarea" defaultValue={"Previous stage summary:\n{{summary}}\n\nChanged files: {{changedFiles}}\nOpen questions: {{openQuestions}}\nBase commit: {{commitHash}}"} />
              <Toggle on={true} label="Structured output (JSON schema)" onChange={() => {}} />
              <div className="ws-prompt-preview"><div className="ws-flabel">Live preview of start-prompt</div><pre className="ws-pre">Previous stage summary:
Planned the token-bucket refactor; 3 files to touch.

Changed files: src/limiter.ts, src/config.ts
Open questions: burst size per route?
Base commit: abc123</pre></div>
            </SectionCard>
          )}
          {cfgTab === 'model' && (
            <SectionCard title="Model & effort">
              <div className="ws-field"><label>Model</label><Dropdown value="sonnet" items={window.WS_MODELS} /></div>
              <div className="ws-field"><label>Effort</label><Segmented value="high" onChange={() => {}} options={[{ id: 'low', label: 'Low' }, { id: 'med', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }]} /></div>
              <Toggle on={true} label="Extended thinking" onChange={() => {}} />
              <div className="ws-set-row2"><div className="ws-field"><label>Max turns</label><input className="ws-input2" defaultValue="40" /></div><div className="ws-field"><label>Max budget (USD)</label><input className="ws-input2" defaultValue="5.00" /></div></div>
            </SectionCard>
          )}
          {cfgTab === 'sandbox' && (
            <SectionCard title="Sandbox & egress">
              <Toggle on={true} label="Enable sandbox" onChange={() => {}} />
              <div className="ws-field"><label>Allowed domains</label><div className="ws-chiprow">{['gitlab.com','registry.npmjs.org','pypi.org'].map(d => <span key={d} className="ws-vchip is-on">{d} <Icon name="xmark" /></span>)}<button type="button" className="ws-txtbtn"><Icon name="plus" /> Add</button></div></div>
              <div className="ws-field"><label>Denied domains</label><div className="ws-chiprow"><span className="ws-vchip">*.internal <Icon name="xmark" /></span></div></div>
              <div className="ws-kv"><span>CPU / memory hint</span><span className="ws-kv-v">2 vCPU · 4 GB</span></div>
            </SectionCard>
          )}
          {cfgTab === 'hooks' && (
            <SectionCard title="Hooks" desc="Preconfigured — these power live activity + status.">
              {[['PostToolUse','→ activity-log', true], ['Notification','→ needs-input', true], ['Stop','→ done', true]].map(([h, d, on]) => (
                <div key={h} className="ws-hookrow"><div><span className="ws-code-inline">{h}</span> <span className="ws-keyrow-meta">{d}</span></div><Toggle on={on} onChange={() => {}} /></div>
              ))}
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PipelineScreen });
