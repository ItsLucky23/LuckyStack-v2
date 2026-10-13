# Template customization

Devkit can fill a newly created empty route or page with starter source. Consumers can override the chosen content and selection rules in their project overlay without forking devkit. An overlay template is an intentional snapshot: it does not silently change when devkit upgrades. Remove an override if you want the current bundled default instead. See the scaffolded `.luckystack/templates/README.md` and the installed template injector for actual kinds and precedence.

Injection is a development aid, not an authority to rewrite nonempty application files. Test empty and pre-existing files when changing this mechanism, especially paired sync files whose generated types must stay consistent. No template selection code belongs in a production bundle.
