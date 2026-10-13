# Extending generated API documentation

Optional metadata lets projects annotate documentation without coupling every producer to a fixed UI release. Renderers should ignore unknown fields rather than failing when a newer producer adds them. Producers should not assume every consumer renders an optional field. The generated JSON and producer/renderer source are the authoritative schema; do not duplicate its field inventory here.

Treat documentation metadata as publishable information. Ownership labels, tags, stream hints and deprecation messages can disclose private design details if the docs are exposed outside the team. Review the access boundary in `mounting.md` before enabling production serving or a custom renderer.
