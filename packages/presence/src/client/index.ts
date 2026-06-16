//? Browser-safe surface of @luckystack/presence. Server-only modules
//? (activity broadcaster, lifecycle hooks, room cleanup) stay in the root
//? barrel so a Vite client bundle never pulls socket.io / Node APIs.
export { SocketStatusIndicator } from './SocketStatusIndicator';
export type { SocketStatusIndicatorProps } from './SocketStatusIndicator';

export { default as LocationProvider } from './LocationProvider';
export type { LocationProviderProps } from './LocationProvider';
