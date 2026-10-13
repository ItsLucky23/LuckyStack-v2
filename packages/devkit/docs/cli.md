# Deployment validation CLI

Validate compiled deployment and service registrations before shipping a multi-service bundle. The validator catches unbound services, broken preset references and unresolved environment references earlier than a live router would. Run `luckystack-validate-deploy --help` for current arguments and exit behavior; the validator source owns its checks and finding shapes.

Registration modules are loaded for their side effects, so their paths must point at the intended compiled environment. Treat warnings as failures in stricter deployment pipelines when a warning might hide a topology error. Do not treat a successful static validation as a replacement for runtime health checks or Redis boot-handshake verification.
