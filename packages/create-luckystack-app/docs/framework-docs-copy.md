# Framework docs copy

The scaffold copies framework rationale into consumer projects so an AI agent can consult package boundaries even before every optional package is installed. Consumer project decisions remain the consumer's own records; framework documentation is not an excuse to overwrite them. The scaffold manifest distinguishes framework-owned copies from user-owned changes during subsequent `luckystack update` runs.

Do not maintain a second file inventory or list of substitutions here: consult the copy/renderer source and scaffold manifest for the actual set. When upgrading, inspect `.new` sidecars rather than overwriting local edits. Framework copy customization is intentional where consumer context differs; do not require the consumer eval README to match the framework-root eval README. AI instruction files must be `AGENTS.md`, not `CLAUDE.md`. The Docker docs asset and copied template must remain byte-identical; changing that copy policy requires explicit review.
