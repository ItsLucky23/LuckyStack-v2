//? Routing rules: marker folder names, version regex, and ignore predicate.
//? Empty here = use defaults (`_api`, `_sync`, `_v{N}.ts`, `_server_v{N}.ts`,
//? `_client_v{N}.ts`, no extra ignores).
//?
//? Example — ignore `__tests__` folders so test files alongside routes
//? don't trip the route-naming validator:
//?
//?   import { registerRoutingRules } from '@luckystack/devkit';
//?   registerRoutingRules({
//?     ignore: (rel) => rel.split('/').includes('__tests__'),
//?   });

export {};
