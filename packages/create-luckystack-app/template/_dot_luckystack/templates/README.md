# Template customization

Devkit injects starter content into new **empty** route and page files during development. These project-owned overrides let you choose or customize that content without forking the framework. They have no production effect and must not rewrite nonempty files.

The files in this folder are snapshots: upgrading devkit does not silently replace your customized templates. Remove a local override when you want to use devkit's current bundled default. The installed devkit template injector and this folder's rules are authoritative for supported kinds, placeholders and selection precedence; do not maintain a parallel list here. See `docs/luckystack/` for route design context.
