# @luckystack/docs-ui — agent guidance

This is a development documentation surface, not a public API catalog by default. Only expose it in production after an explicit access-control decision; generated endpoint metadata and the optional request runner can disclose information or exercise authenticated endpoints. See `README.md` for a minimal start and `docs/mounting.md` for the access boundary.

Escaping endpoint metadata before HTML insertion is a security invariant. Authorization and environment checks belong before serving both page and JSON, and a custom template must uphold its own escaping. Keep this package independent of a React build step; source and generated API docs, not this file, define supported options and field shapes.
