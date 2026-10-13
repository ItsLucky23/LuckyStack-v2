# Boot handshake and fallback

Two Redis endpoints may both answer health probes while pointing at incompatible clusters. A router that accepts both could silently split sessions and socket rooms across topologies. The boot UUID handshake detects this before accepting traffic; failure to write the local handshake cannot be treated as an ordinary warning. Synchronized environment values are compared as hashes so their plaintext need not cross the boundary.

Strict drift checks can refuse startup rather than serve an inconsistent fallback. The handshake happens at boot, not continuously: repointing Redis on a running fallback requires operational redeployment and verification. Development fallback exists to support a locally incomplete service set; it is not permission to direct sensitive development traffic to staging without reviewing the binding. Source defines current keys, probes and strictness; do not copy the protocol's conditional steps here.
