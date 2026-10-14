import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';

dotenv.config();

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const isProduction = process.env.NODE_ENV === 'production';

function withoutSslMode(databaseUrl?: string): string | undefined {
  if (!databaseUrl) {
    return databaseUrl;
  }

  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    return databaseUrl;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.delete('sslmode');
    return parsedUrl.toString();
  } catch {
    const [base, query] = databaseUrl.split('?');
    if (!query) {
      return base;
    }

    const params = query.split('&').filter((item) => item && !/^sslmode=/i.test(item));
    return params.length > 0 ? `${base}?${params.join('&')}` : base;
  }
}

const poolConfig: ConstructorParameters<typeof Pool>[0] = {
  connectionString: withoutSslMode(process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL),
  max: 5, connectionTimeoutMillis: 5000, query_timeout: 8000, statement_timeout: 8000,
};

if (isProduction) {
  poolConfig.ssl = { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT || readFileSync(process.env.DATABASE_CA_FILE || new URL('../../certs/rds-global-bundle.pem', import.meta.url), 'utf8') };
}

if (isProduction && !process.env.RUNTIME_DATABASE_URL) throw new Error('Restricted runtime database credentials are required');
const pool = new Pool(poolConfig);
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: [],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
