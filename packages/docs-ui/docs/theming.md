# Docs UI theming

Lightweight branding lets an internal documentation page resemble its host project without requiring a frontend build. Use the built-in branding option for cosmetic changes; a full custom template is appropriate only when the document structure must change. The custom template takes responsibility for escaped content, accessibility and secure request-runner behavior.

The installed renderer and types define supported branding fields. Avoid copying a palette/default table here: values and theme behavior belong in source, while the important design boundary is that appearance changes do not bypass the environment or authorization gate. See `mounting.md` before enabling production access.
