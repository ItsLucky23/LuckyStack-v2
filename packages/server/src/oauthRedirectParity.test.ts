import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

//? OAuth providers require authorize and token exchange to send a byte-identical
//? redirect_uri. Pin both framework chokepoints to the same core resolver so a
//? future edit cannot fix one side and silently break the other.
describe('OAuth redirect URI parity', () => {
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
});
