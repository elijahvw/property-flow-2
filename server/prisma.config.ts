import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const isPostgresUrl = /^postgres(?:ql)?:\/\//i.test(databaseUrl);

const migrationDatabaseUrl = (() => {
  if (!isProduction || !isPostgresUrl) {
    return databaseUrl;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.set('sslmode', 'no-verify');
    return parsedUrl.toString();
  } catch {
    const separator = databaseUrl.includes('?') ? '&' : '?';
    return databaseUrl.includes('sslmode=')
      ? databaseUrl.replace(/sslmode=[^&]*/i, 'sslmode=no-verify')
      : `${databaseUrl}${separator}sslmode=no-verify`;
  }
})();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrationDatabaseUrl,
  },
});
