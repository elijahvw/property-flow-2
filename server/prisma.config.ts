import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const separator = databaseUrl.includes('?') ? '&' : '?';
const migrationDatabaseUrl = databaseUrl.includes('sslmode=')
  ? databaseUrl
  : `${databaseUrl}${separator}sslmode=require`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrationDatabaseUrl,
  },
});
