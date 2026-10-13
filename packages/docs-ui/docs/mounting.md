# Mounting the docs UI

The docs handler composes with the server's custom-route mechanism rather than taking over general request routing. Mount it only where generated API docs should be available. See `README.md` for a short start and the installed `mountDocsUi` types for current options and handler signatures.

**Default production lockdown is intentional.** Even without an interactive request runner, generated endpoint names, auth requirements and data shapes may be sensitive. If production access is necessary, explicitly enable it and enforce per-request authorization before returning both the page and its JSON. A non-loopback development bind also warrants access review. A missing generated file is not authorization to serve old or invented documentation: regenerate artifacts instead.
