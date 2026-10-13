# @luckystack/docs-ui

A development UI for generated LuckyStack API documentation. In a scaffolded project use `npx luckystack add docs-ui`, or install `@luckystack/docs-ui` and mount its handler through the server's custom routes. Generate API artifacts with the project's `generateArtifacts` script if the UI reports that they are missing. See [mounting](./docs/mounting.md) for the access boundary.

**Do not expose the documentation route publicly by accident.** Production access is disabled by default; if you intentionally enable it, add authorization and review generated metadata for sensitive detail. The optional interactive request runner uses the browser's credentials and should only be enabled for trusted developers. Custom HTML templates must escape content from generated metadata; see [HTML generation](./docs/html-generation.md).
