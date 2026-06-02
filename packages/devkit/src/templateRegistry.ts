//? Consumer-facing registry for scaffold templates AND the selection logic
//? that decides WHICH template a newly-created file receives.
//?
//? Two layers live here:
//?   1. Content overrides — `registerTemplate(kind, content)`: replace the body
//?      of a template kind with a custom string.
//?   2. Selection rules — `registerTemplateRule(...)` / `registerTemplateKind(...)`:
//?      decide, given a classified file context, which kind to inject. The
//?      built-in defaults below ARE expressed as rules, so a consumer can
//?      inspect, edit, remove, or extend them from a single overlay file
//?      (`.luckystack/templates/templateRules.ts`, auto-loaded by devkit in dev).
//?
//? `templateInjector.ts` reads from this module: it classifies the file
//? (api / sync_server / sync_client / page), asks `resolveTemplateKind(ctx)`
//? for the kind, then resolves content (consumer file → override → bundled).

/**
 * The six template kinds the framework ships out of the box. Consumers may
 * register additional kinds (e.g. `page_marketing`) via `registerTemplateKind`.
 */
export type BuiltInTemplateKind =
  | 'api'
  | 'sync_server'
  | 'sync_client_paired'
  | 'sync_client_standalone'
  | 'page_plain'
  | 'page_dashboard';

//? `(string & {})` keeps editor autocomplete for the built-in literals while
//? still accepting arbitrary consumer-defined kind names.
export type TemplateKind = BuiltInTemplateKind | (string & {});

export const BUILT_IN_TEMPLATE_KINDS: readonly BuiltInTemplateKind[] = [
  'api',
  'sync_server',
  'sync_client_paired',
  'sync_client_standalone',
  'page_plain',
  'page_dashboard',
];

//? Page templates are `.tsx` (they contain JSX); the rest are `.ts`. The
//? injector reads them as plain text, so the extension is cosmetic at runtime
//? but load-bearing for the package's own `tsc` program.
export const BUILT_IN_TEMPLATE_FILENAMES: Record<BuiltInTemplateKind, string> = {
  api: 'api.template.ts',
  sync_server: 'sync_server.template.ts',
  sync_client_paired: 'sync_client_paired.template.ts',
  sync_client_standalone: 'sync_client_standalone.template.ts',
  page_plain: 'page_plain.template.tsx',
  page_dashboard: 'page_dashboard.template.tsx',
};

/**
 * Structural classification of the file an injection is being computed for.
 * `templateInjector.ts` derives this from the folder + filename conventions
 * (controlled separately via `registerRoutingRules`). Selection rules match
 * against it to choose a template kind.
 */
export interface TemplateMatchContext {
  /** Absolute path of the file being created. */
  filePath: string;
  /** Structural kind derived from the route conventions. */
  fileKind: 'api' | 'sync_server' | 'sync_client' | 'page';
  /** For `sync_client`: whether a paired `_server_v<N>.ts` exists on disk. */
  hasPairedServer: boolean;
  /** Path relative to `src/` (forward slashes), or `null` if outside src. */
  srcRelativePath: string | null;
}

/** A single template-selection rule. First matching rule (by priority) wins. */
export interface TemplateRule {
  kind: TemplateKind;
  match: (ctx: TemplateMatchContext) => boolean;
  /** Higher runs first. Built-in defaults use 10 (specific) / 0 (catch-all). */
  priority: number;
}

interface StoredRule extends TemplateRule {
  /** Insertion sequence — later registrations win ties (consumer over default). */
  order: number;
}

export interface RegisterTemplateKindOptions {
  /** Predicate deciding when this kind is chosen. */
  match: (ctx: TemplateMatchContext) => boolean;
  /** Optional inline template body (same as calling `registerTemplate`). */
  content?: string;
  /** Higher runs first. Defaults to 100 so consumer kinds beat the built-ins. */
  priority?: number;
}

const overrides = new Map<TemplateKind, string>();
const rules: StoredRule[] = [];
let insertionCounter = 0;

//? Dashboard-flavor heuristic for `page.tsx`. Exported so the scaffolded
//? consumer `templateRules.ts` can reuse the exact same regex when it
//? re-declares the default rule (and edit it in place).
export const DEFAULT_DASHBOARD_PATH_PATTERN = /\/(admin|dashboard|settings|billing|account|profile)(\/|$)/;

// ---------------------------------------------------------------------------
// Content overrides (v1 API — unchanged surface)
// ---------------------------------------------------------------------------

/**
 * Override the template body for a given kind. Subsequent injections emit the
 * supplied content with the standard `{{REL_PATH}}` / `{{PAGE_PATH}}` /
 * `{{SYNC_NAME}}` placeholder substitution. Resolution order in the injector
 * is: consumer file (`.luckystack/templates/<kind>.template.*`) → this
 * override → bundled disk template.
 */
export const registerTemplate = (kind: TemplateKind, content: string): void => {
  overrides.set(kind, content);
};

/** Read the registered content override for a kind, or `null` when none. */
export const getRegisteredTemplate = (kind: TemplateKind): string | null => {
  return overrides.get(kind) ?? null;
};

/** Drop every content override. Test-only. */
export const clearTemplateOverrides = (): void => {
  overrides.clear();
};

/** Diagnostic: kinds that currently have a content override. */
export const listRegisteredTemplateKinds = (): readonly TemplateKind[] => {
  return [...overrides.keys()];
};

// ---------------------------------------------------------------------------
// Selection rules (decide WHICH kind a file gets)
// ---------------------------------------------------------------------------

/**
 * Register a selection rule. Rules are evaluated by descending `priority`,
 * ties broken by descending registration order (so a later registration —
 * e.g. a consumer overlay — beats an earlier same-priority default).
 */
export const registerTemplateRule = (rule: TemplateRule): void => {
  rules.push({ ...rule, order: insertionCounter++ });
};

/**
 * Register a brand-new template kind: its selection predicate plus (optionally)
 * its inline content. Equivalent to `registerTemplateRule` + `registerTemplate`
 * in one call. Default priority 100 so custom kinds win over the built-ins.
 */
export const registerTemplateKind = (kind: TemplateKind, options: RegisterTemplateKindOptions): void => {
  registerTemplateRule({ kind, match: options.match, priority: options.priority ?? 100 });
  if (typeof options.content === 'string') {
    registerTemplate(kind, options.content);
  }
};

/** Drop every selection rule (including the built-in defaults). */
export const clearTemplateRules = (): void => {
  rules.length = 0;
};

/** Read the active rules in evaluation order (priority desc, then newest first). */
export const getTemplateRules = (): readonly TemplateRule[] => {
  return rules
    .toSorted((a, b) => (b.priority - a.priority) || (b.order - a.order))
    .map(({ kind, match, priority }) => ({ kind, match, priority }));
};

/** Evaluate the active rules against a context; returns the first matching kind. */
export const resolveTemplateKind = (ctx: TemplateMatchContext): TemplateKind | null => {
  for (const rule of getTemplateRules()) {
    //? `rule.match` is a user-supplied predicate, NOT String.prototype.match —
    //? the prefer-regexp-test rule is a false positive on this member call.
    // eslint-disable-next-line unicorn/prefer-regexp-test
    if (rule.match(ctx)) return rule.kind;
  }
  return null;
};

/**
 * Register the framework's built-in default selection rules. Expressed as
 * ordinary rules so a consumer can replace them: call `clearTemplateRules()`
 * then re-register a subset (the scaffolded `templateRules.ts` does exactly
 * this). Idempotent guard prevents double-registration on repeated imports.
 */
let defaultsRegistered = false;
export const registerDefaultTemplateRules = (): void => {
  if (defaultsRegistered) return;
  defaultsRegistered = true;
  registerTemplateRule({ kind: 'api', priority: 10, match: (c) => c.fileKind === 'api' });
  registerTemplateRule({ kind: 'sync_server', priority: 10, match: (c) => c.fileKind === 'sync_server' });
  registerTemplateRule({ kind: 'sync_client_paired', priority: 10, match: (c) => c.fileKind === 'sync_client' && c.hasPairedServer });
  registerTemplateRule({ kind: 'sync_client_standalone', priority: 10, match: (c) => c.fileKind === 'sync_client' && !c.hasPairedServer });
  registerTemplateRule({
    kind: 'page_dashboard',
    priority: 10,
    match: (c) => c.fileKind === 'page' && DEFAULT_DASHBOARD_PATH_PATTERN.test(c.filePath.replaceAll('\\', '/').toLowerCase()),
  });
  //? Catch-all for pages — lowest priority so the dashboard rule wins first.
  registerTemplateRule({ kind: 'page_plain', priority: 0, match: (c) => c.fileKind === 'page' });
};

/**
 * Test-only: clear rules + content overrides AND re-arm the defaults guard so
 * `registerDefaultTemplateRules()` can repopulate a clean baseline.
 */
export const resetTemplateRegistryForTests = (): void => {
  clearTemplateRules();
  clearTemplateOverrides();
  defaultsRegistered = false;
};

//? Arm the built-in defaults on module load so any importer (the injector,
//? unit tests, a host without a consumer overlay) has a working baseline.
registerDefaultTemplateRules();
