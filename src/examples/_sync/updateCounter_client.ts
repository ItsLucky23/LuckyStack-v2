/**
 * Sync Client Handler
 * 
 * This runs for EACH client that might receive the sync event.
 * Return { status: 'success' } to allow the client to receive the event.
 * Return { status: 'error' } to skip this client.
 */

import { ClientSyncProps } from "config";

const main = ({ user, clientData }: ClientSyncProps) => {
  // Allow all clients on the /examples page to receive the event
  // In a real app, you might filter by user.id, user.admin, etc.

  console.log('Sync client check:', user?.location?.pathName);

  // Check if user is on the examples page
  if (user?.location?.pathName === '/examples') {
    return {
      status: 'success',
      // You can add additional data here that will be passed to the client
      processed: true
    };
  }

  // Also allow for /test (legacy)
  if (user?.location?.pathName === '/test') {
    return { status: 'success' };
  }

  // Return error to skip other clients
  return { status: 'error' };
}

export { main }