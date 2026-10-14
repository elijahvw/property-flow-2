import 'dotenv/config';
import { defineConfig } from 'prisma/config';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const migrationUrl = new URL(databaseUrl);
if (process.env.NODE_ENV === 'production') {
  // Prisma Migrate's engine has its own documented TLS URL parameters.
  // The pg adapter's TLS configuration is handled separately.
  migrationUrl.searchParams.set('sslmode', 'require');
  migrationUrl.searchParams.set('sslaccept', 'strict');
  // The container installs every AWS RDS root in the OS trust store.
  // A single explicit trust anchor may be supplied for isolated TLS tests.
  if (process.env.DATABASE_CA_FILE) migrationUrl.searchParams.set('sslcert', process.env.DATABASE_CA_FILE);
}
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationUrl.href },
});
