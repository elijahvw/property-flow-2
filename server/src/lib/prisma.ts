import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

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
};

if (isProduction) {
  poolConfig.ssl = { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT };
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
