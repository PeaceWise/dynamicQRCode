export interface Config {
  baseUrl: string; // no trailing slash, e.g. https://example.com
  adminPassword: string;
  sessionSecret: string;
  defaultRedirectUrl: string | null;
  port: number;
  tz: string;
  databasePath: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required setting ${name}. Add it to your .env file (see .env.example).`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = required(env, 'BASE_URL').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(baseUrl)) {
    throw new Error('BASE_URL must look like https://example.com (no path).');
  }

  const adminPassword = required(env, 'ADMIN_PASSWORD');
  if (adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32');
  }

  const defaultRedirectUrl = env.DEFAULT_REDIRECT_URL?.trim() || null;
  if (defaultRedirectUrl && !/^https?:\/\//i.test(defaultRedirectUrl)) {
    throw new Error('DEFAULT_REDIRECT_URL must start with http:// or https://');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a number between 1 and 65535.');
  }

  return {
    baseUrl,
    adminPassword,
    sessionSecret,
    defaultRedirectUrl,
    port,
    tz: env.TZ?.trim() || 'America/New_York',
    databasePath: env.DATABASE_PATH?.trim() || '/data/qr.db',
  };
}
