# Template substitution

Placeholders let one starter become a named project without committing personal credentials or hand-editing the framework. The renderer and template files are the source of truth for placeholder names, slug validation and text-file detection; keep no parallel token/default table here.

When adding a placeholder, update its producer and consumers together and verify it cannot leak into the generated app unintentionally. Treat real secret values as local-only, even when a template includes safe env variable names. Framework docs are rendered for the consumer's context rather than mechanically copied as developer-repository instructions; never replace the consumer's own decision or lesson records. Docker docs copied from the CLI asset must stay byte-identical to the template copy.
