# @luckystack/mcp — agent guidance

This is a read-only query interface over local LuckyStack AI context. Prefer a targeted tool query to loading whole generated indexes; generated artifacts are a local cache rebuilt from committed sources. If an artifact is missing or stale, regenerate it with the project's `ai:*` scripts rather than fabricating an answer. See `README.md` for setup.

Never add write operations or log secret-bearing source content as a side effect of querying. Decision and lesson records are historical sources; do not silently rewrite them to match current implementation. A stale graph is a reason to refresh, not a reliable blast-radius answer.
