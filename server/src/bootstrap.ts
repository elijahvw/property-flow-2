import './tracing.js';

// The web process uses only the restricted runtime connection.
delete process.env.DATABASE_URL;
await import('./index.js');
