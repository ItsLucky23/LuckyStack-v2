/* Workspaces UI kit — auth & onboarding (plain layout). */
const { useState: useStateAuth } = React;

function AuthShell({ children, wide }) {
  return (
    <div className="ws-auth">
      <div className={'ws-auth-card' + (wide ? ' is-wide' : '')}>
        <div className="ws-auth-brand"><img src="assets/logo-mark.svg" alt="" /><span>Workspaces</span></div>
        {children}
      </div>
      <div className="ws-auth-foot">Self-hosted · your code stays yours</div>
    </div>
  );
}

function LoginScreen() {
  const [loading, setLoading] = useStateAuth(null);
  return (
    <AuthShell>
      <h1 className="ws-auth-title">Welcome to Workspaces</h1>
      <p className="ws-auth-sub">Sign in to orchestrate your AI development pipeline.</p>
      <div className="ws-auth-actions">
        <button type="button" className="ws-btn ws-btn-primary ws-auth-oauth" onClick={() => setLoading('gitlab')}>
          <Icon name="code-branch" /> {loading === 'gitlab' ? 'Connecting…' : 'Continue with GitLab'}
        </button>
        <button type="button" className="ws-btn ws-btn-secondary ws-auth-oauth" onClick={() => setLoading('github')}>
          <Icon name="code-branch" /> {loading === 'github' ? 'Connecting…' : 'Continue with GitHub'}
        </button>
      </div>
    </AuthShell>
  );
}

function SshLinkScreen() {
  const [phase, setPhase] = useStateAuth('idle'); // idle | verifying | linked
  return (
    <AuthShell>
      <h1 className="ws-auth-title">Link an SSH key to open terminals</h1>
      <p className="ws-auth-sub">Your private key stays on your device; we only store the public half — just like GitLab.</p>
      {phase !== 'linked' && (
        <div className="ws-banner is-warn ws-banner-thin" style={{ margin: '0 0 14px' }}><Icon name="lock" /><div><strong>Terminals locked</strong> — add a key to enable terminal access.</div></div>
      )}
      <div className="ws-field"><label>Public key</label><textarea className="ws-textarea" placeholder="ssh-ed25519 AAAAC3Nza… you@machine" /></div>
      <div className="ws-field"><label>Key name</label><input className="ws-input2" placeholder="MacBook Pro" /></div>
      <button type="button" className="ws-btn ws-btn-primary" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
        onClick={() => { setPhase('verifying'); setTimeout(() => setPhase('linked'), 1200); }}>
        {phase === 'verifying' ? <><Icon name="spinner" className="ws-spin" /> Verifying…</> : phase === 'linked' ? <><Icon name="circle-check" /> Linked</> : 'Verify & add key'}
      </button>
      <div className="ws-auth-keys">
        <div className="ws-auth-keys-h">Linked keys</div>
        {phase === 'linked' ? (
          <div className="ws-keyrow"><Icon name="key" className="ws-keyrow-ic" /><div className="ws-keyrow-main"><div className="ws-keyrow-name">MacBook Pro <span className="ws-chip2">ed25519</span></div><div className="ws-keyrow-fp ws-code-inline">SHA256:9f3a…7c21</div></div><span className="ws-chip2 is-live">just now</span></div>
        ) : <div className="ws-auth-keys-empty">No keys linked yet.</div>}
        <div className={'ws-keyrow-badge' + (phase === 'linked' ? '' : ' is-off')}><Icon name={phase === 'linked' ? 'circle-check' : 'lock'} /> Terminal access {phase === 'linked' ? 'enabled' : 'disabled'}</div>
      </div>
    </AuthShell>
  );
}

function AcceptInviteScreen() {
  return (
    <AuthShell>
      <div className="ws-invite-ws"><span className="ws-ws-badge" style={{ width: 44, height: 44, fontSize: 20, borderRadius: 12 }}>Y</span></div>
      <h1 className="ws-auth-title">Sanne invited you to YouComm Core</h1>
      <p className="ws-auth-sub">You'll join as <span className="ws-rolechip is-admin">Admin</span></p>
      <div className="ws-auth-actions">
        <button type="button" className="ws-btn ws-btn-primary ws-auth-oauth"><Icon name="check" /> Accept invite</button>
        <button type="button" className="ws-btn ws-btn-ghost ws-auth-oauth">Decline</button>
      </div>
    </AuthShell>
  );
}

function OnboardingScreen() {
  const [step, setStep] = useStateAuth(1);
  const [verify, setVerify] = useStateAuth(null); // null | ok | fail
  const total = 4;
  return (
    <AuthShell wide>
      <div className="ws-wiz-steps">{[1,2,3,4].map(n => <span key={n} className={'ws-wiz-dot' + (n === step ? ' is-active' : n < step ? ' is-done' : '')}>{n < step ? <Icon name="check" /> : n}</span>)}</div>
      <h1 className="ws-auth-title">{['Create your workspace','Connect GitLab','Select projects','First index'][step-1]}</h1>

      {step === 1 && (<>
        <div className="ws-field"><label>Workspace name</label><input className="ws-input2" defaultValue="YouComm Core" /></div>
        <div className="ws-field"><label>Slug</label><div className="ws-slugrow"><span className="ws-slugpre">workspaces.app/</span><input className="ws-input2" defaultValue="youcomm-core" readOnly /></div></div>
      </>)}
      {step === 2 && (<>
        <div className="ws-field"><label>GitLab base URL</label><input className="ws-input2" defaultValue="https://gitlab.com" /></div>
        <div className="ws-field"><label>Access token</label><div className="ws-tokenrow"><input className="ws-input2" type="password" defaultValue="glpat-xxxxxxxx" /><Button variant="secondary" onClick={() => setVerify('ok')}>Verify connection</Button></div></div>
        {verify === 'ok' && <div className="ws-conn-ok"><Icon name="circle-check" /> Connected to gitlab.com</div>}
      </>)}
      {step === 3 && (<>
        <p className="ws-auth-sub" style={{ textAlign: 'left' }}>Pick the repos this workspace manages.</p>
        {['youcomm/app','youcomm/api','youcomm/infra'].map((p, i) => (
          <label key={p} className="ws-onb-proj"><span className={'ws-cb ' + (i === 0 ? 'on' : 'off')}>{i === 0 && <Icon name="check" />}</span><span className="ws-code-inline">{p}</span></label>
        ))}
      </>)}
      {step === 4 && (<>
        <div className="ws-onb-prog"><div className="ws-onb-bar"><span style={{ width: '34%' }} /></div><div className="ws-onb-progmeta">Indexing 4,210 / 12,400 files · ~3 min left</div></div>
        {[['Project summary','done'],['RAG semantic index','indexing'],['Code graph','queued']].map(([n,s]) => (
          <div key={n} className="ws-onb-src"><span>{n}</span><span className={'ws-chip2 ' + (s==='done'?'is-live':'')}>{s==='indexing' ? <><Icon name="spinner" className="ws-spin" /> {s}</> : s}</span></div>
        ))}
        <div className="ws-banner is-ok ws-banner-thin" style={{ margin: '12px 0 0' }}><Icon name="circle-info" /><div>You can use the board while indexing.</div></div>
      </>)}

      <div className="ws-wiz-nav">
        {step > 1 && <Button variant="ghost" onClick={() => setStep(step-1)}>Back</Button>}
        <Button onClick={() => setStep(Math.min(total, step+1))} icon={step === total ? 'check' : null}>{step === total ? 'Go to board' : 'Continue'}</Button>
      </div>
    </AuthShell>
  );
}

Object.assign(window, { LoginScreen, SshLinkScreen, AcceptInviteScreen, OnboardingScreen });
