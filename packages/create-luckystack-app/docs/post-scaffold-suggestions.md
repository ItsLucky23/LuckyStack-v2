# After scaffolding

Follow the generated project's README for local configuration and any data-layer generation or initialization required by your selected choices. Put real credentials in ignored local configuration; do not commit them into the scaffold or include them in bug reports.

Package installation and ORM generation are part of a usable scaffold unless deliberately skipped. If either was skipped, finish those steps before expecting a working app; use the generated scripts for the chosen data layer instead of a handwritten universal command here. For upgrades of an existing app, update dependencies and run `luckystack update`, then review `.new` files so developer customizations survive. Avoid advertising optional packages that the consumer did not select as if they were already installed.
