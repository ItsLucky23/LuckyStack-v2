/* Workspaces UI kit — Usage & budget screen (Wave 2). */
const { useState: useStateUsage } = React;

function UsageScreen({ ctx }) {
  const b = window.WS_BUDGET;
  const pct = Math.round((b.spent / b.cap) * 100);
  const over = pct >= b.alertPct;
  const [autopause, setAutopause] = useStateUsage(true);
  const spark = [3.2, 5.8, 4.1, 7.4, 6.0, 9.2, 8.1]; // last 7 days
  const max = Math.max(...spark);
  return (
    <div className="ws-screen">
      <ScreenHead title="Usage" sub={`${b.currency}${b.spent.toFixed(2)} of ${b.currency}${b.cap} this month`} />
      <div className="ws-usage-wrap">
        {over && (
          <div className="ws-banner is-warn"><Icon name="triangle-exclamation" /><div><strong>{pct}% of budget used</strong><p>You're past the {b.alertPct}% alert threshold. Agents auto-pause at 100%.</p></div><Button variant="secondary" onClick={() => ctx.openModal('budget')}>Budget settings</Button></div>
        )}
        <div className="ws-usage-grid">
          <SectionCard title="Monthly budget">
            <div className="ws-budget-bar"><span className={over ? 'is-warn' : ''} style={{ width: pct + '%' }} /></div>
            <div className="ws-budget-meta"><span className="ws-kv-v">{b.currency}{b.spent.toFixed(2)} spent</span><span className="ws-muted2">{b.currency}{(b.cap - b.spent).toFixed(2)} left · resets in 9 days</span></div>
          </SectionCard>
          <SectionCard title="Spend · last 7 days">
            <div className="ws-spark">{spark.map((v, i) => <span key={i} style={{ height: (v / max * 64) + 'px' }} title={`${b.currency}${v}`} />)}</div>
          </SectionCard>
        </div>
        <SectionCard title="Breakdown by ticket" right={<Button variant="secondary" icon="download">Export CSV</Button>}>
          <div className="ws-table-card" style={{ boxShadow: 'none', border: 'none' }}>
            <table className="ws-table">
              <thead><tr><th>Ticket</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th><th>Time</th></tr></thead>
              <tbody>
                {window.WS_USAGE_ROWS.map(r => (
                  <tr key={r.ticket} onClick={() => ctx.openTicket(r.ticket)}>
                    <td className="ws-td-mono">{r.ticket}</td><td className="ws-td-dim">{r.tin}</td><td className="ws-td-dim">{r.tout}</td>
                    <td className="ws-td-titlecell">{b.currency}{r.cost.toFixed(2)}</td><td className="ws-td-dim">{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title="Budget settings">
          <div className="ws-set-row2">
            <div className="ws-field"><label>Monthly cap ({b.currency})</label><input className="ws-input2" defaultValue={b.cap} /></div>
            <div className="ws-field"><label>Alert at (%)</label><input className="ws-input2" defaultValue={b.alertPct} /></div>
          </div>
          <Toggle on={autopause} onChange={setAutopause} label="Auto-pause all agents at 100% of cap" />
        </SectionCard>
      </div>
    </div>
  );
}

Object.assign(window, { UsageScreen });
