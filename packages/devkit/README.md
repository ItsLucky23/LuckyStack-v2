# @luckystack/devkit

Development-time tooling for LuckyStack route loading, type-map generation, template injection, hot reload, and deployment validation. Install as a development dependency:

```bash
npm install --save-dev @luckystack/devkit
```

Do not import devkit watchers or the TypeScript Program in production code. Production reads generated route artifacts instead of recompiling or watching sources. The focused [`docs/`](./docs/) explain why live reload stays off the request path, why type generation reports unresolved types, and why consumer template overrides are retained across upgrades. Use the installed exports and CLI `--help` for current API and invocation details.
