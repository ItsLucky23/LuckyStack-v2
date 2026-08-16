import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  registerBindAddress,
  registerBoundAddress,
  resolveDevCallbackUrl,
} from '@luckystack/core';

//? OAuth providers require authorize and token exchange to send a byte-identical
//? redirect_uri. Pin both framework chokepoints to the same core resolver so a
//? future edit cannot fix one side and silently break the other.
describe('OAuth redirect URI parity', () => {
  it('registers programmatic port metadata before request-time OAuth resolution', () => {
    const createServerSource = fs.readFileSync(
      path.join(import.meta.dirname, 'createServer.ts'),
      'utf8',
    );

    expect(createServerSource).toContain(
      'registerBindAddress({ ip, port, configuredPort: options.defaultPort })',
    );
  });

  it('uses resolveDevCallbackUrl at authorize and token-exchange time', () => {
    const authorizeSource = fs.readFileSync(
      path.join(import.meta.dirname, 'httpRoutes', 'authApiRoute.ts'),
      'utf8',
    );
    const exchangeSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../login/src/login.ts'),
      'utf8',
    );

    expect(authorizeSource).toContain('redirect_uri: resolveDevCallbackUrl(provider.callbackURL)');
    expect(exchangeSource).toContain('const redirectUri = resolveDevCallbackUrl(provider.callbackURL)');
    expect(exchangeSource).toContain('redirect_uri: redirectUri');
    expect(exchangeSource).toContain("formParams.append('redirect_uri', redirectUri)");
  });

  it('keeps authorize and token-exchange redirect URIs byte-identical after a hop', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 4787 });
    registerBoundAddress({ ip: '127.0.0.1', port: 4788 });

    const callback = 'http://localhost:4787/auth/callback/google';
    const authorizeRedirectUri = resolveDevCallbackUrl(callback);
    const tokenExchangeRedirectUri = resolveDevCallbackUrl(callback);

    expect(authorizeRedirectUri).toBe('http://localhost:4788/auth/callback/google');
    expect(tokenExchangeRedirectUri).toBe(authorizeRedirectUri);
  });
});
