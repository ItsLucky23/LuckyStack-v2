// Generic local-only replica-set election. This intentionally creates no users,
// application records, seed data, or credentials.
try {
  if (rs.status().ok !== 1) throw new Error('replica set not initialized');
} catch {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'database:27017' }] });
}

while (!db.hello().isWritablePrimary) sleep(500);
