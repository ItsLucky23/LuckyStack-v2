/// <reference types="vite/client" />

declare const __IS_PROD__: boolean;

interface ImportMetaEnv {
	readonly VITE_SENTRY_DSN?: string;
	readonly VITE_SENTRY_ENABLED?: 'true' | 'false';
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
