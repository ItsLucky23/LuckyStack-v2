# Skill: add-new-component

Build only a UI capability no existing primitive/composition covers. Duplication creates inconsistent interaction and accessibility policy.

## Procedure

1. Query capabilities and similar pages; inspect nested component families and installed framework exports before concluding a primitive is missing.
2. Extend or compose existing field/overlay primitives. Reuse their accessibility and positioning contracts rather than recreating them.
3. Follow the actual sibling prop/types/style patterns and `AGENTS.md`. Colours come from `src/index.css`; user-facing text uses the translator or caller-owned text. Do not copy a token/component inventory into this skill.
4. Decide the required state ownership and accessibility assertions. Do not add unused controlled/uncontrolled options merely because a generic template once did.
5. If this is framework-authored consumer content, maintain the intended template/asset parity and test the shipped copy. Application-specific UI must not be mirrored into every consumer by default.
6. Verify the component's behaviour with appropriate tests; request approval for browser verification. Refresh context and run the feature-boundary gate.

Add only non-obvious local rationale comments. The component source, not a duplicated starter example here, is the usage authority.
