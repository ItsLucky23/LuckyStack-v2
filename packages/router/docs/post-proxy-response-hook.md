# Proxy observation hooks

Proxy hooks let consumers record a request's upstream outcome without intercepting or buffering streamed bodies. The response hook is triggered when upstream headers arrive or when transport fails before headers; it is **not** an end-to-end body-delivery timing signal. If a client disconnects later, a header-time success does not imply the full response arrived. Inspect hook payload types for current fields instead of mirroring their shape here.

An error before an HTTP response is different from a backend's returned error status. Keep those cases distinct in metrics. Redact sensitive URL segments, headers and identifiers before sending hook data to logs or trackers; never log bodies or tokens by default. Observational hooks do not replace target pinning or authorization in the proxy. See `http-proxy.md`.
