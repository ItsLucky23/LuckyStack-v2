import { registerApiMethodMap } from '@luckystack/core/client';

import { apiMethodMap } from './apiTypes.generated';

// Routed HTTP must use each route's generated method instead of inferring it
// from the route name. Socket invocation is unaffected by this registration.
registerApiMethodMap(apiMethodMap);

export { apiRequest } from '@luckystack/core/client';
export type { ApiStreamEvent } from '@luckystack/core/client';
