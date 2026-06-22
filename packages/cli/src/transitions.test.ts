import { describe, it, expect } from 'vitest';
import { planChanges, type DesiredConfig } from './transitions';

const cfg = (over: Partial<DesiredConfig> = {}): DesiredConfig => ({
  authMode: 'none',
  oauthProviders: [],
  email: 'none',
  monitoring: 'none',
  toggles: { presence: false, sync: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: false },
  ...over,
});

const summaries = (c: DesiredConfig, d: DesiredConfig): string[] => planChanges(c, d).map((ch) => ch.summary);

describe('planChanges — no-op', () => {
  it('is empty when current equals desired', () => {
    expect(planChanges(cfg(), cfg())).toEqual([]);
  });
});

describe('planChanges — auth', () => {
  it('none → credentials adds login', () => {
    expect(summaries(cfg(), cfg({ authMode: 'credentials' }))).toEqual(['Auth: enable credentials login']);
  });

  it('none → credentials+oauth(google,github) adds login + both providers', () => {
    const out = summaries(cfg(), cfg({ authMode: 'credentials+oauth', oauthProviders: ['google', 'github'] }));
    expect(out).toEqual([
      'Auth: enable credentials login',
      'OAuth provider google: add',
      'OAuth provider github: add',
    ]);
  });

  it('credentials+oauth(google,github) → none removes both providers + login', () => {
    const from = cfg({ authMode: 'credentials+oauth', oauthProviders: ['google', 'github'] });
    expect(summaries(from, cfg())).toEqual([
      'OAuth provider google: remove',
      'OAuth provider github: remove',
      'Auth: → none (remove login)',
    ]);
  });

  it('adds only the newly-selected provider', () => {
    const from = cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] });
    const to = cfg({ authMode: 'credentials+oauth', oauthProviders: ['google', 'github'] });
    expect(summaries(from, to)).toEqual(['OAuth provider github: add']);
  });

  it('dropping to plain credentials removes the providers but keeps login', () => {
    const from = cfg({ authMode: 'credentials+oauth', oauthProviders: ['google'] });
    const to = cfg({ authMode: 'credentials' });
    expect(summaries(from, to)).toEqual(['OAuth provider google: remove']);
  });
});

describe('planChanges — email & monitoring', () => {
  it('email none → resend', () => {
    expect(summaries(cfg(), cfg({ email: 'resend' }))).toEqual(['Email: none → resend']);
  });
  it('monitoring none → sentry', () => {
    expect(summaries(cfg(), cfg({ monitoring: 'sentry' }))).toEqual(['Monitoring: none → sentry']);
  });
});

describe('planChanges — toggles', () => {
  it('presence off → on', () => {
    expect(summaries(cfg(), cfg({ toggles: { presence: true, sync: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: false } }))).toEqual(['presence: off → on']);
  });
  it('docs-ui on → off', () => {
    const from = cfg({ toggles: { presence: false, sync: false, 'docs-ui': true, 'secret-manager': false, router: false, mcp: false } });
    expect(summaries(from, cfg())).toEqual(['docs-ui: on → off']);
  });
  it('secret-manager off → on', () => {
    expect(summaries(cfg(), cfg({ toggles: { presence: false, sync: false, 'docs-ui': false, 'secret-manager': true, router: false, mcp: false } }))).toEqual(['secret-manager: off → on']);
  });
  it('router off → on', () => {
    expect(summaries(cfg(), cfg({ toggles: { presence: false, sync: false, 'docs-ui': false, 'secret-manager': false, router: true, mcp: false } }))).toEqual(['router: off → on']);
  });
  it('mcp off → on', () => {
    expect(summaries(cfg(), cfg({ toggles: { presence: false, sync: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: true } }))).toEqual(['mcp: off → on']);
  });
});

describe('planChanges — preview ↔ apply parity (effects content)', () => {
  it('email resend → smtp previews dropping the old resend block + adding smtp keys', () => {
    const effects = planChanges(cfg({ email: 'resend' }), cfg({ email: 'smtp' }))[0]?.effects.join(' | ') ?? '';
    expect(effects).toContain('resend placeholder block');
    expect(effects).toContain('+ smtp placeholder keys');
  });

  it('monitoring sentry → posthog previews removing @sentry/node + "(already present)" + adding posthog', () => {
    const effects = planChanges(cfg({ monitoring: 'sentry' }), cfg({ monitoring: 'posthog' }))[0]?.effects.join(' | ') ?? '';
    expect(effects).toContain('- @sentry/node');
    expect(effects).toContain('already present');
    expect(effects).toContain('+ posthog-node');
  });

  it('does not duplicate the summary headline inside effects (email)', () => {
    const change = planChanges(cfg(), cfg({ email: 'resend' }))[0];
    expect(change?.effects.some((e) => e.startsWith('Email:'))).toBe(false);
  });
});

describe('planChanges — combined', () => {
  it('orders auth, email, monitoring, toggles', () => {
    const to = cfg({ authMode: 'credentials', email: 'resend', monitoring: 'sentry', toggles: { presence: true, sync: false, 'docs-ui': false, 'secret-manager': false, router: false, mcp: false } });
    expect(summaries(cfg(), to)).toEqual([
      'Auth: enable credentials login',
      'Email: none → resend',
      'Monitoring: none → sentry',
      'presence: off → on',
    ]);
  });
});
