//? Generic single-slot DI-registry factory. LuckyStack's `register* / get* /
//? is*Registered / reset*ForTests` triad is hand-rolled a dozen-plus times in
//? this package (and again downstream in `@luckystack/server`). Each copy is
//? the same shape: a module-level mutable slot, a setter that flips a
//? "registered" flag, a call-time getter, a boolean guard, and an optional
//? test-reset. This factory centralises that boilerplate while staying
//? flexible enough for the variants that exist in the wild:
//?
//?   - registers that return the stored value (deployConfig, servicesConfig)
//?     vs. return void (projectConfig, logger, notifier).
//?   - getters that fall back to a default vs. throw when nothing is
//?     registered (servicesConfig).
//?   - a debug-log line on each register (rateLimiter strategy).
//?   - an optional input → stored transform (projectConfig deep-merges the
//?     consumer's deep-partial over the defaults before storing).
//?
//? Registries with genuinely bespoke storage (keyed slots like the
//? prisma/redis client map, additive Set-based registries, multi-handler
//? arrays) are intentionally NOT a fit for this single-slot factory and stay
//? hand-rolled.

//? When no `transform` is supplied, `TInput` must equal `TStored` so the
//? identity store is type-safe (no cast). When they differ, a `transform` is
//? mandatory — `RequireTransform` makes that a compile error rather than a
//? runtime surprise.
type RequireTransform<TInput, TStored> = [TInput] extends [TStored]
  ? { transform?: (input: TInput, current: TStored) => TStored }
  : { transform: (input: TInput, current: TStored) => TStored };

interface RegistryOptionsBase<TStored> {
  /**
   * Called once per `register` with the freshly-stored value — used for the
   * rate-limiter's `[RateLimiter] active strategy → …` debug line. Runs after
   * the slot is updated so a logger registry can log through itself.
   */
  onRegister?: (stored: TStored) => void;
  /**
   * Resolve the value `get` returns when nothing has been registered yet.
   * Defaults to returning `defaultValue`. `servicesConfig` throws here.
   */
  resolveDefault?: () => TStored;
}

export type RegistryOptions<TInput, TStored> = RegistryOptionsBase<TStored> &
  RequireTransform<TInput, TStored>;

export interface Registry<TInput, TStored> {
  /** Store a value (after the optional `transform`) and mark the slot registered. */
  register: (input: TInput) => TStored;
  /** Read the active value at call time (registered value, else the default). */
  get: () => TStored;
  /** True once `register` has been called at least once. */
  isRegistered: () => boolean;
  /** Restore the unregistered state (test-only). */
  reset: () => void;
}

/**
 * Create a single-slot registry. `defaultValue` is returned by `get` until
 * `register` is called (unless `resolveDefault` overrides that). When
 * `TInput` differs from `TStored`, the `transform` option is mandatory (the
 * `RequireTransform` constraint enforces it); when they match it is optional
 * and defaults to identity. The second positional argument is likewise
 * optional only in the identity case.
 */
export function createRegistry<TStored, TInput = TStored>(
  defaultValue: TStored,
  ...optionsArg: [TInput] extends [TStored]
    ? [options?: RegistryOptions<TInput, TStored>]
    : [options: RegistryOptions<TInput, TStored>]
): Registry<TInput, TStored> {
  //? Implementation body uses a single erased `unknown` boundary so the
  //? identity fallback needs no per-instantiation cast. The public overload
  //? above keeps every call site fully typed; this boundary is internal only.
  const options = (optionsArg[0] ?? {}) as {
    transform?: (input: unknown, current: unknown) => unknown;
    onRegister?: (stored: unknown) => void;
    resolveDefault?: () => unknown;
  };
  const { transform, onRegister, resolveDefault } = options;

  let active: unknown = defaultValue;
  let registered = false;

  const register = (input: TInput): TStored => {
    active = transform ? transform(input, active) : input;
    registered = true;
    if (onRegister) onRegister(active);
    return active as TStored;
  };

  const get = (): TStored => {
    if (registered) return active as TStored;
    return (resolveDefault ? resolveDefault() : defaultValue) as TStored;
  };

  const isRegistered = (): boolean => registered;

  const reset = (): void => {
    active = defaultValue;
    registered = false;
  };

  return { register, get, isRegistered, reset };
}
