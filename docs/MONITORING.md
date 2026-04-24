# LuckyStack Observability & Monitoring Strategy

## 1. Packaging Strategy: @luckystack/monitoring
To align with the "Compose & Hook" architecture, monitoring should be extracted into a dedicated package that consumes the core lifecycle hooks. This prevents "monitoring bloat" in the core and allows the AI to extend functionality via hooks rather than internal edits.

### A. Core Hook Integration
The package will register listeners on the `core` hook registry:
* **preApiExecute:** Initialize a unique `correlationId` and start a high-resolution timer.
* **postApiExecute:** Capture final output, calculate duration, and ship data to OpenSearch.
* **postErrorNormalize:** Link exception metadata to the current `correlationId`.
* **postSyncFanout:** Track real-time message distribution volume and latency.

### B. The "Dual-Stream" Data Flow
* **Sentry Package:** Focuses on the "Why." It handles stack traces, breadcrumbs, and error grouping.
* **Monitoring Package:** Focuses on the "What." It handles the high-volume JSON audit trail (inputs/outputs) and performance metrics.

---

## 2. Resulting Data Map (What we have after implementation)
Once these packages are wired into the `apiRequest` and `server.ts` lifecycle, you will possess a complete audit trail for every service (system, vehicles, housing, etc.).

### I. Request Forensics (OpenSearch)
* **Identity:** `userId`, `sessionId`, `ipAddress`.
* **Routing:** `serviceKey` (e.g., "vehicles"), `routeKey` (e.g., "getAll"), `version`.
* **Payloads:** Full `input` JSON and `output` JSON for every call (the "boss" requirement).
* **Performance:** `executionTimeMs`, `payloadSize`, and `isColdStart`.
* **Trace Link:** `correlationId` (the bridge to Sentry).

### II. Error Intelligence (Sentry)
* **Exception Context:** Stack traces, environment variables, and local variable states.
* **User Journey:** Breadcrumbs showing the sequence of API calls leading to the crash.
* **Impact:** Automatic alerts when a specific service (e.g., `system`) exceeds an error threshold.

### III. System Vitals (Metrics/Prometheus)
* **Throughput:** Requests per second per service.
* **Latency Percentiles:** P95 and P99 response times (vital for identifying "slow" routes).
* **Socket Health:** Current active Socket.io connections and event frequency.
* **Resource Usage:** RSS Memory, Heap usage, and Event Loop lag per backend bundle.

---

## 4. Remaining Gaps: What is still missing?
While the current plan is 90% complete for industry standards, two "silent" areas remain:

### A. Dependency/Downstream Latency
If the `vehicles` service calls an external NPM dependency or a third-party API (like Stripe or a database), your logs currently only show total execution time. 
* **Recommendation:** Add "Sub-segment timing" to your `apiRequest` tool to track how much time was spent inside the function vs. waiting on external IO.

### B. Dead-Letter / Timeout Tracking
In a serverless-like build, if a function hangs and the server kills the process, your `postApiExecute` hook might never run.
* **Recommendation:** Implement a "Heartbeat" or "Request Start" log. If you have an `API_START` entry in OpenSearch without a corresponding `POST` entry, you can identify hidden timeouts that Sentry might miss.

### C. Client-Side Experience (RUM)
You have deep backend visibility, but you lack data on how long the user's browser takes to process the Socket.io message or render the UI.
* **Recommendation:** Eventually add a `@luckystack/web-vitals` package to track frontend performance.

---

## 5. Summary of Implementation Value
By using the **First-Segment Routing** (`service/action`), your monitoring data becomes automatically "grouped." You won't just see that "an API is slow"; you will see that "The **Vehicles Service** is 200ms slower than the **System Service**," allowing for surgical debugging and scaling of specific backend bundles.