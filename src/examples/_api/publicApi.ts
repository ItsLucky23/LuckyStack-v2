/**
 * Public API - Can be called by anyone
 * 
 * This API doesn't require any authentication.
 * Perfect for health checks, public data, etc.
 */

import { AuthProps } from 'config';

// No authentication required
export const auth: AuthProps = {
  login: false,
};

export const main = async () => {
  return {
    status: 'success',
    result: {
      message: 'This API can be called without logging in!',
      timestamp: new Date().toISOString(),
      serverTime: Date.now()
    }
  };
};
