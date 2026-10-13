# HTML generation

The default documentation page is self-contained HTML rather than a separate React bundle, so a development server can serve generated docs without a frontend build. The UI fetches generated metadata at request time rather than embedding a hand-maintained API inventory. See the renderer source for current selectors, field handling and template-builder parameters.

Generated endpoint metadata is not inherently safe HTML: escape text and attribute content before inserting it. Reject dangerous image schemes such as `data:` and `javascript:` for branding logos, including SVG payloads. A replacement template takes ownership of that escaping and URL validation. The optional interactive request runner sends live requests using the browser's session; enabling it on an untrusted surface is not just a documentation choice. Restrict access before making it available, and avoid reflecting sensitive response bodies in logs.
