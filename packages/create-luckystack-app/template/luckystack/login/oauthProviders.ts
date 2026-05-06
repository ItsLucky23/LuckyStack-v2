//? OAuth providers. Edit this file to enable or disable providers.
//? The credentials provider is always enabled. To turn on Google, GitHub,
//? etc., uncomment the relevant block and set the matching env vars in
//? `.env.local` (DEV_GOOGLE_CLIENT_ID, DEV_GITHUB_CLIENT_ID, …).

import {
  registerOAuthProviders,
  credentialsProvider,
  // googleProvider,
  // githubProvider,
  // discordProvider,
  // facebookProvider,
  // microsoftProvider,
  type OAuthProvider,
} from '@luckystack/login';

const backendUrl =
  process.env.DNS || `http://${process.env.SERVER_IP ?? '127.0.0.1'}:${process.env.SERVER_PORT ?? '80'}`;

const callback = (name: string): string => `${backendUrl}/auth/callback/${name}`;
const dev = process.env.NODE_ENV !== 'production';
const env = (prodKey: string, devKey: string): string =>
  (dev ? process.env[devKey] : process.env[prodKey]) ?? '';

const providers: OAuthProvider[] = [
  credentialsProvider(),
];

// Example: enable Google when DEV_GOOGLE_CLIENT_ID is set.
//
// if (env('GOOGLE_CLIENT_ID', 'DEV_GOOGLE_CLIENT_ID')) {
//   providers.push(googleProvider({
//     clientId: env('GOOGLE_CLIENT_ID', 'DEV_GOOGLE_CLIENT_ID'),
//     clientSecret: env('GOOGLE_CLIENT_SECRET', 'DEV_GOOGLE_CLIENT_SECRET'),
//     callbackUrl: callback('google'),
//   }));
// }

void env; void callback;

registerOAuthProviders(providers);
