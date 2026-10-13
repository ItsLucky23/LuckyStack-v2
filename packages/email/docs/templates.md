# Email templates

The lightweight layout helper suits plain transactional mail without a separate templating stack. Named templates let the application customize framework mail content without forking login; register overrides at boot and use project localization where appropriate. The installed template API and built-in templates are the source of truth for supported fields, names and precedence.

Email clients favor inline styles, hence the layout's deliberately small styling surface. Caller-supplied text must be escaped before entering HTML; do not pass untrusted HTML to the helper. Use absolute action URLs or recipients may get unusable links. If you build a custom HTML template, you own escaping, text fallback and link safety. Test-only registry resets must never run on a live sender process.
