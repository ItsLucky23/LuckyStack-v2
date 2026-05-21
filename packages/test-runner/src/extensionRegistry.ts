//? Extension registry for the test runner. Consumers plug in custom test
//? layers, realistic-payload fixtures, and result reporters without
//? forking the framework.
//?
//? Three slots:
//?
//?   1. Test layers — additional checks per endpoint (CORS enforcement,
//?      business rules, custom auth schemes, multi-tenant isolation).
//?   2. Fixtures — realistic input payloads (valid + invalid) per typeKey
//?      so the fuzz layer can use them before falling back to schema-random.
//?   3. Reporters — per-result and per-summary callbacks + optional
//?      webhook URL the runner POSTs the batch summary to.
//?
//? All slots are append-only at registration time; clearing requires
//? `resetTestExtensionsForTests()` (kept out of the production surface
//? to prevent accidental wipes from a misbehaving plugin).

export interface TestLayerInput {
  /** Resolved route name (`api/billing/getInvoice/v1`). */
  endpoint: string;
  /** Method when applicable, undefined for sync endpoints. */
  method?: string;
  /** Bearer token / session token to use for auth-aware checks. */
  authToken?: string;
}

export interface TestLayerResult {
  passed: boolean;
  /** Short reason key — i18n-style errorCode when failed. */
  message?: string;
  /** Optional extras for the reporter (latency, response sample, ...). */
  metadata?: Record<string, unknown>;
}

export interface TestLayer {
  name: string;
  run: (input: TestLayerInput) => Promise<TestLayerResult> | TestLayerResult;
}

export interface TestFixture<TPayload = unknown> {
  valid: TPayload[];
  invalid: TPayload[];
}

export interface TestResult {
  layer: string;
  endpoint: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TestSummary {
  totalLayers: number;
  totalEndpoints: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

export interface TestReporter {
  /** Called once per individual TestResult as the runner progresses. */
  onResult?: (result: TestResult) => void | Promise<void>;
  /** Called once at the end with the aggregated summary. */
  onSummary?: (summary: TestSummary) => void | Promise<void>;
  /** Optional webhook the runner POSTs the summary to. */
  webhookUrl?: string;
  webhookAuth?: { type: 'bearer'; token: string };
}

const layers = new Map<string, TestLayer>();
const fixtures = new Map<string, TestFixture>();
let reporter: TestReporter | null = null;

/**
 * Register a custom test layer. Re-registering the same name replaces
 * the previous entry. Use for CORS enforcement, business-rule checks,
 * custom auth schemes, multi-tenant isolation, GDPR data-flow checks.
 */
export const registerTestLayer = (layer: TestLayer): void => {
  layers.set(layer.name, layer);
};

export const listTestLayers = (): TestLayer[] => [...layers.values()];

/**
 * Register a realistic payload fixture for a specific type key. The fuzz
 * layer prefers these over schema-random generated inputs when a fixture
 * exists for the endpoint's input type.
 *
 * `valid` payloads are used to verify happy-path behavior; `invalid`
 * payloads probe the validator's error responses.
 */
export const registerTestFixture = <TPayload = unknown>(typeKey: string, fixture: TestFixture<TPayload>): void => {
  fixtures.set(typeKey, fixture as TestFixture);
};

export const getTestFixture = (typeKey: string): TestFixture | undefined => fixtures.get(typeKey);

/**
 * Register a test reporter. Set `null` to unregister. The runner calls
 * `onResult` per individual result as the run progresses and `onSummary`
 * once at the end. When `webhookUrl` is set, the runner additionally
 * POSTs the JSON-serialised summary to that URL.
 */
export const registerTestReporter = (newReporter: TestReporter | null): void => {
  reporter = newReporter;
};

export const getTestReporter = (): TestReporter | null => reporter;

export const resetTestExtensionsForTests = (): void => {
  layers.clear();
  fixtures.clear();
  reporter = null;
};
