/* Workspaces UI kit — primitives. Mirrors the real _components' look & token use. */
const { useState, useEffect, useRef } = React;

/* Close a popover when the user clicks/taps outside its root, or presses Escape.
   Mirrors the real useDropdownMenu close behaviour — robust, no blocking scrim. */
function useClickAway(active, onAway) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onAway(); };
    const onKey = (e) => { if (e.key === 'Escape') onAway(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [active, onAway]);
  return ref;
}

/* Avatar — round image w/ initials-on-colour fallback (mirrors Avatar.tsx) */
function Avatar({ user, size = 28, fontSize }) {
  return (
    <div className="ws-avatar" style={{
      width: size, height: size, fontSize: fontSize ?? size * 0.42,
      backgroundColor: user.avatarFallback ?? '#9ca3af',
    }}>
      {(user.name?.[0] ?? '').toUpperCase()}
    </div>
  );
}

/* AvatarStack — overlapping members + "+N" */
function AvatarStack({ users, max = 3, size = 22 }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="ws-avstack">
      {shown.map((u, i) => (
        <div key={u.id} className="ws-avstack-item" style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <Avatar user={u} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div className="ws-avstack-item ws-avstack-more" style={{ width: size, height: size, marginLeft: -size * 0.32 }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

const STATUS_META = {
  'needs-input': { label: 'Needs input', color: 'var(--warning)', bg: 'rgba(224,146,10,.13)', dark: 'rgba(240,169,59,.16)' },
  busy:          { label: 'Busy',        color: 'var(--primary)', bg: 'rgba(59,130,246,.12)', pulse: true },
  done:          { label: 'Done',        color: 'var(--correct)', bg: 'rgba(22,163,74,.13)' },
  idle:          { label: 'No AI',       color: 'var(--muted)',   bg: 'rgba(138,147,161,.15)' },
};

function StatusPill({ status, dot = true }) {
  const m = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <span className="ws-pill" style={{ background: m.bg, color: m.color }}>
      {dot && <span className={'ws-pill-dot' + (m.pulse ? ' ws-pulse' : '')} style={{ background: m.color }} />}
      {m.label}
    </span>
  );
}

function Label({ name }) {
  const c = window.WS_LABEL_COLORS[name] ?? { bg: 'var(--container2)', fg: 'var(--common)' };
  return <span className="ws-label-chip" style={{ background: c.bg, color: c.fg }}>{name}</span>;
}

function Icon({ name, className = '', style }) {
  return <i className={`fa-solid fa-${name} ${className}`} style={style} />;
}

function Button({ variant = 'primary', icon, children, onClick, title }) {
  return (
    <button className={`ws-btn ws-btn-${variant}`} onClick={onClick} title={title} type="button">
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

function IconButton({ icon, onClick, title, active }) {
  return (
    <button className={'ws-iconbtn' + (active ? ' is-active' : '')} onClick={onClick} title={title} type="button">
      <Icon name={icon} />
    </button>
  );
}

/* A lightweight dropdown matching the real Dropdown look (trigger + popover).
   onChange(id) for simple use; onSelect(item) gives the whole item (mirrors real API). */
function Dropdown({ label, icon, items, value, onChange, onSelect, align = 'left', showSearch }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useClickAway(open, () => setOpen(false));
  const current = items.find(i => i.id === value);
  const shown = showSearch && q ? items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())) : items;
  const pick = (it) => { onChange?.(it.id); onSelect?.(it); setOpen(false); setQ(''); };
  return (
    <div className="ws-dd" ref={ref}>
      <button type="button" className="ws-dd-trigger" onClick={() => setOpen(o => !o)}>
        {icon && <Icon name={icon} className="ws-dd-leadicon" />}
        <span className="ws-dd-label">{current ? current.label : label}</span>
        <Icon name="caret-down" className={'ws-dd-caret' + (open ? ' is-open' : '')} />
      </button>
      {open && (
        <div className={'ws-dd-menu ' + (align === 'right' ? 'is-right' : '')}>
          {showSearch && (
            <div className="ws-dd-search"><Icon name="magnifying-glass" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" /></div>
          )}
          {shown.map(it => (
            <div key={it.id}
              className={'ws-dd-opt' + (it.id === value ? ' is-sel' : '')}
              onClick={() => pick(it)}>
              <span>{it.label}</span>
              {it.id === value && <Icon name="check" className="ws-dd-check" />}
            </div>
          ))}
          {shown.length === 0 && <div className="ws-dd-empty">No results</div>}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Avatar, AvatarStack, StatusPill, Label, Icon, Button, IconButton, Dropdown, STATUS_META, useClickAway });

/* ---- Shared layout primitives used across screens ---- */
function ScreenHead({ title, sub, children }) {
  return (
    <div className="ws-shead">
      <div className="ws-shead-l">
        <span className="ws-shead-h1">{title}</span>
        {sub && <span className="ws-shead-sub">{sub}</span>}
      </div>
      {children && <div className="ws-shead-tools">{children}</div>}
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="ws-utabs">
      {tabs.map(t => (
        <button key={t.id} type="button"
          className={'ws-utab' + (active === t.id ? ' is-active' : '')}
          onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}{t.label}
          {t.count != null && <span className="ws-utab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function Segmented({ options, value, onChange, size }) {
  return (
    <div className={'ws-seg2' + (size === 'sm' ? ' is-sm' : '')}>
      {options.map(o => (
        <button key={o.id} type="button"
          className={value === o.id ? 'is-on' : ''}
          onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" className="ws-togrow" onClick={() => onChange?.(!on)}>
      <span className={'ws-tog ' + (on ? 'is-on' : 'is-off')}><span className="ws-tog-k" /></span>
      {label && <span className="ws-tog-label">{label}</span>}
    </button>
  );
}

function SectionCard({ title, desc, children, right }) {
  return (
    <section className="ws-sect">
      {(title || right) && (
        <div className="ws-sect-head">
          <div><div className="ws-sect-title">{title}</div>{desc && <div className="ws-sect-desc">{desc}</div>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function EmptyState({ icon, title, sub, action }) {
  return (
    <div className="ws-empty">
      {icon && <Icon name={icon} className="ws-empty-ic" />}
      <div className="ws-empty-t">{title}</div>
      {sub && <div className="ws-empty-s">{sub}</div>}
      {action}
    </div>
  );
}

Object.assign(window, { ScreenHead, Tabs, Segmented, Toggle, SectionCard, EmptyState });

/* Small action popover menu (e.g. a row's ⋯). items: {label, icon, danger, onClick} */
function PopMenu({ items, align = 'right', triggerClass = 'ws-iconbtn ws-iconbtn-sm', icon = 'ellipsis' }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  return (
    <div className="ws-dd" ref={ref}>
      <button type="button" className={triggerClass} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}><Icon name={icon} /></button>
      {open && (
        <div className={'ws-dd-menu ' + (align === 'right' ? 'is-right' : '')} style={{ minWidth: 180 }}>
          {items.map((it, i) => it.divider
            ? <div key={i} className="ws-dd-divider" />
            : <button key={i} type="button" className={'ws-dd-opt as-btn' + (it.danger ? ' is-danger' : '')} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(); }}>
                <span>{it.icon && <Icon name={it.icon} className="ws-dd-leadicon" />}{it.label}</span>
              </button>)}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PopMenu });
