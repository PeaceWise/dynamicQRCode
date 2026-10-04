import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Configuration error: ${(err as Error).message}`);
  process.exit(1);
}

const db = openDatabase(config.databasePath);
const { app, scanLogger } = createApp({ db, config });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Dynamic QR is running on port ${info.port}. Public address: ${config.baseUrl}`);
  if (config.adminPassword === 'change-me-please') {
    console.warn('WARNING: ADMIN_PASSWORD is still the example value. Change it in .env!');
  }
});

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    scanLogger.flush();
    db.close();
    process.exit(0);
  });
  // Don't hang forever on open keep-alive connections.
  setTimeout(() => {
    scanLogger.flush();
    db.close();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
