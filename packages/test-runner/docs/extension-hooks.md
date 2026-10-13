# Custom test extensions

Built-in sweeps validate the framework envelope and common guards. Consumer extensions are for business authorization, tenant boundaries, CORS and other project-specific requirements that generated route metadata cannot prove. Fixtures and reporters exist to share setup and results without forcing those checks into framework code. The installed types and extension source define registration keys and result shapes.

Registered layers see the same route selection as the sweeps: sync routes when sync metadata is passed, narrowed by the same filter. A sync route has no HTTP method, so a layer must not assume one. Each call also receives the schema-valid sample payload the contract sweep sends, so a layer can drive a route past input validation instead of only exercising its rejection path. Sample strings carry the run's test-data marker; rows created this way are not removed by the test reset.

Reporter failures should not turn a correct endpoint into a failed test, but they can hide alerts: monitor reporting separately. A webhook can transmit endpoint names, error details and bearer credentials; use trusted HTTPS destinations and do not put secrets into summary data. A warning about plaintext transport is not protection against exposure. Test-only extension resets are destructive and must not run in production or in a long-running shared harness.
