# Browser presence components

The separate `/client` entry keeps Node/socket server dependencies out of browser bundles. A socket status indicator is user feedback, not proof that a mutation reached the server. A location provider can communicate route context to peers, but URL query strings often contain secrets: forward only explicitly reviewed parameters. See `../src/client/index.ts`, `../src/client/SocketStatusIndicator.tsx`, `../src/client/LocationProvider.tsx`.

Keep the surrounding route rendering usable when optional presence updates are disabled; presence should not block navigation. Consult component source for props, styling and behavior rather than duplicating them here.
